#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

APP="${APP:-gpt-image-cc}"
PLATFORM="${PLATFORM:-linux/amd64}"
REGISTRY_PUBLIC="${REGISTRY_PUBLIC:-crpi-9jyz42cz1n1dtzno.cn-hangzhou.personal.cr.aliyuncs.com/supercc25513/cc}"
REGISTRY_VPC="${REGISTRY_VPC:-crpi-9jyz42cz1n1dtzno-vpc.cn-hangzhou.personal.cr.aliyuncs.com/supercc25513/cc}"
VERSION="${VERSION:-}"
REFRESH_RELEASE_ONLY=0

usage() {
  cat >&2 <<'EOF'
usage:
  docker-config/release-image.sh [--version VERSION] [--refresh-release-only]

Builds and pushes the GPT Image Canvas image, then updates:
  docker-config/release.yaml

options:
  --version VERSION        image tag, default next free gpt-image-cc-YYYYMMDD-NNN
  --refresh-release-only  update release.yaml for an already-pushed tag
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      if [[ -z "${2:-}" ]]; then
        echo "--version requires a value." >&2
        exit 2
      fi
      VERSION="${2:-}"
      shift 2
      ;;
    --refresh-release-only)
      REFRESH_RELEASE_ONLY=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage
      exit 2
      ;;
  esac
done

python3 - <<'PY'
import yaml  # noqa: F401
PY

validate_version() {
  local version="$1"

  if [[ "${version}" == "latest" || "${version}" == *":latest" ]]; then
    echo "Refusing to publish latest tag." >&2
    exit 1
  fi

  if ! [[ "${version}" =~ ^[a-z0-9][a-z0-9-]*-[0-9]{8}-[0-9]{3}(-[a-f0-9]{7,40})?$ ]]; then
    echo "Version must match {app-slug}-YYYYMMDD-NNN or include a git suffix." >&2
    exit 1
  fi
}

current_release_tag() {
  python3 - <<'PY'
from pathlib import Path

import yaml

path = Path("docker-config/release.yaml")
if not path.exists():
    raise SystemExit(0)

data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
tag = (data.get("image") or {}).get("tag") or ""
print(tag)
PY
}

next_default_version() {
  local today prefix sequence version

  today="$(date +%Y%m%d)"
  prefix="${APP}-${today}"
  sequence="$(
    python3 - "$prefix" <<'PY'
import re
import sys
from pathlib import Path

import yaml

prefix = sys.argv[1]
sequence = 0
path = Path("docker-config/release.yaml")
if path.exists():
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    tag = str((data.get("image") or {}).get("tag") or "")
    match = re.fullmatch(re.escape(prefix) + r"-(\d{3})(?:-[a-f0-9]{7,40})?", tag)
    if match:
        sequence = int(match.group(1))
print(sequence + 1 if sequence else 1)
PY
  )"

  while true; do
    version="${prefix}-$(printf "%03d" "${sequence}")"
    if ! docker manifest inspect "${REGISTRY_PUBLIC}:${version}" >/dev/null 2>&1; then
      echo "${version}"
      return
    fi
    sequence=$((sequence + 1))
  done
}

if [[ -z "${VERSION}" ]]; then
  if [[ "$REFRESH_RELEASE_ONLY" -eq 1 ]]; then
    VERSION="$(current_release_tag)"
  fi
  VERSION="${VERSION:-$(next_default_version)}"
fi

validate_version "${VERSION}"

IMAGE_PUBLIC="${REGISTRY_PUBLIC}:${VERSION}"
IMAGE_VPC="${REGISTRY_VPC}:${VERSION}"

update_release_yaml() {
  local manifest_digest generated_at git_commit git_branch git_dirty dirty_notes

  if [[ ! -f docker-config/release.yaml ]]; then
    echo "Missing docker-config/release.yaml; cannot update deployment handoff." >&2
    exit 1
  fi

  manifest_digest="$(docker buildx imagetools inspect "${IMAGE_PUBLIC}" 2>/dev/null | awk '/Digest:/ {print $2; exit}')"
  generated_at="$(TZ=Asia/Shanghai date '+%Y-%m-%dT%H:%M:%S+08:00')"
  git_commit="$(git rev-parse HEAD 2>/dev/null || true)"
  git_branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  if [[ -n "$(git status --porcelain 2>/dev/null || true)" ]]; then
    git_dirty="true"
    dirty_notes="Image built from current worktree; uncommitted changes were present."
  else
    git_dirty="false"
    dirty_notes=""
  fi

  python3 - "$VERSION" "$PLATFORM" "$IMAGE_PUBLIC" "$IMAGE_VPC" "$manifest_digest" "$generated_at" "$git_commit" "$git_branch" "$git_dirty" "$dirty_notes" <<'PY'
import sys
from pathlib import Path

import yaml

(
    version,
    platform,
    image_public,
    image_vpc,
    manifest_digest,
    generated_at,
    git_commit,
    git_branch,
    git_dirty,
    dirty_notes,
) = sys.argv[1:]

path = Path("docker-config/release.yaml")
data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}

previous_image_vpc = (data.get("image") or {}).get("image_vpc") or ""
previous_rollback = (data.get("image") or {}).get("rollback_image_vpc") or ""
rollback_image_vpc = previous_image_vpc if previous_image_vpc and previous_image_vpc != image_vpc else previous_rollback

handoff = data.setdefault("handoff", {})
handoff["generated_at"] = generated_at
handoff["generated_by"] = "release-image.sh"

app = data.setdefault("app", {})
app["name"] = app.get("name") or "gpt-image-cc"
app["git_commit"] = git_commit
app["git_branch"] = git_branch
app["git_dirty"] = git_dirty == "true"
app["dirty_notes"] = dirty_notes

image = data.setdefault("image", {})
image["tag"] = version
image["platform"] = platform
image["dockerfile"] = "docker-config/Dockerfile"
image["dockerignore"] = "docker-config/Dockerfile.dockerignore"
image["image_public"] = image_public
image["image_vpc"] = image_vpc
image["rollback_image_vpc"] = rollback_image_vpc
image["build_command"] = f"VERSION={version} docker-config/release-image.sh"
image["pushed"] = True
image["manifest_digest"] = manifest_digest

verification = data.setdefault("verification", {})
image_build = verification.setdefault("image_build", {})
image_build["command"] = f"docker buildx build --platform {platform} -f docker-config/Dockerfile -t {image_public} --push ."
image_build["result"] = "passed"

image_push = verification.setdefault("image_push", {})
image_push["command"] = f"VERSION={version} docker-config/release-image.sh"
image_push["result"] = "passed"

local_smoke = verification.get("local_smoke_test")
if isinstance(local_smoke, dict) and "run_command" in local_smoke:
    old = local_smoke["run_command"].split()[-1]
    local_smoke["run_command"] = local_smoke["run_command"].replace(old, image_public)

remote_manifest = verification.setdefault("remote_manifest", {})
remote_manifest["command"] = f"docker manifest inspect {image_public}"
remote_manifest["result"] = "passed"

rollback = data.setdefault("rollback", {})
if rollback_image_vpc and ":" in rollback_image_vpc:
    rollback["previous_tag"] = rollback_image_vpc.rsplit(":", 1)[-1]

path.write_text(yaml.safe_dump(data, sort_keys=False, allow_unicode=True), encoding="utf-8")
PY
}

if [[ "$REFRESH_RELEASE_ONLY" -eq 1 ]]; then
  if ! docker manifest inspect "${IMAGE_PUBLIC}" >/dev/null 2>&1; then
    echo "Remote tag does not exist: ${IMAGE_PUBLIC}" >&2
    exit 1
  fi
  update_release_yaml
  echo "release updated: docker-config/release.yaml"
  echo "IMAGE_PUBLIC=${IMAGE_PUBLIC}"
  echo "IMAGE_VPC=${IMAGE_VPC}"
  echo "PLATFORM=${PLATFORM}"
  echo "VERSION=${VERSION}"
  exit 0
fi

if docker manifest inspect "${IMAGE_PUBLIC}" >/dev/null 2>&1; then
  echo "Remote tag already exists: ${IMAGE_PUBLIC}" >&2
  exit 1
fi

docker buildx build \
  --platform "${PLATFORM}" \
  -f docker-config/Dockerfile \
  -t "${IMAGE_PUBLIC}" \
  --push \
  .

update_release_yaml

cat <<EOF
release updated: docker-config/release.yaml
IMAGE_PUBLIC=${IMAGE_PUBLIC}
IMAGE_VPC=${IMAGE_VPC}
PLATFORM=${PLATFORM}
VERSION=${VERSION}
EOF
