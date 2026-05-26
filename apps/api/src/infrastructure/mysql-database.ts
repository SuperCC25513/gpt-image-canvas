import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { ensureRuntimeStorage } from "./runtime.js";
import type { MySqlDatabaseConfig } from "./database-config.js";

export interface MySqlDatabaseContext {
  driver: "mysql";
  pool: Pool;
  close: () => Promise<void>;
}

const tableOptions = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";
const DEFAULT_REGISTRATION_CREDITS = 10;
const DEFAULT_GENERATION_CREDIT_COST = 1;
const DEFAULT_CHECKIN_CREDIT = 1;
const DEFAULT_MAX_IMAGES_PER_REQUEST = 16;

interface MySqlColumnDefinition {
  name: string;
  definition: string;
  addDefinition?: string;
  comment: string;
}

interface MySqlTableDefinition {
  name: string;
  comment: string;
  columns: MySqlColumnDefinition[];
  constraints: string[];
}

const mySqlSchema: MySqlTableDefinition[] = [
  {
    name: "users",
    comment: "本地账号、密码哈希、角色、状态和积分余额",
    columns: [
      { name: "id", definition: "VARCHAR(191) PRIMARY KEY NOT NULL", comment: "用户唯一标识" },
      { name: "name", definition: "TEXT NOT NULL", comment: "用户展示名称" },
      { name: "email", definition: "VARCHAR(254) NOT NULL", comment: "规范化后的登录邮箱" },
      { name: "password_salt", definition: "TEXT NOT NULL", comment: "密码哈希盐值" },
      { name: "password_iterations", definition: "INT NOT NULL", comment: "密码 PBKDF2 迭代次数" },
      { name: "password_hash", definition: "TEXT NOT NULL", comment: "密码哈希值" },
      { name: "role", definition: "VARCHAR(32) NOT NULL", comment: "用户角色，user 或 admin" },
      { name: "status", definition: "VARCHAR(32) NOT NULL", comment: "账号状态，active、pending 或 disabled" },
      { name: "credits", definition: "INT NOT NULL DEFAULT 0", comment: "当前积分余额" },
      { name: "created_at", definition: "VARCHAR(32) NOT NULL", comment: "创建时间 ISO 字符串" },
      { name: "updated_at", definition: "VARCHAR(32) NOT NULL", comment: "更新时间 ISO 字符串" }
    ],
    constraints: ["UNIQUE KEY users_email_idx (email)"]
  },
  {
    name: "sessions",
    comment: "浏览器登录会话令牌哈希",
    columns: [
      { name: "token_hash", definition: "VARCHAR(191) PRIMARY KEY NOT NULL", comment: "会话 Cookie 令牌的 SHA-256 哈希" },
      { name: "user_id", definition: "VARCHAR(191) NOT NULL", comment: "会话所属用户 ID" },
      { name: "expires_at", definition: "VARCHAR(32) NOT NULL", comment: "会话过期时间 ISO 字符串" },
      { name: "created_at", definition: "VARCHAR(32) NOT NULL", comment: "创建时间 ISO 字符串" },
      { name: "last_seen_at", definition: "VARCHAR(32)", comment: "最近访问时间 ISO 字符串" }
    ],
    constraints: ["KEY sessions_user_id_idx (user_id)", "KEY sessions_expires_at_idx (expires_at)"]
  },
  {
    name: "app_settings",
    comment: "应用注册、积分和生成限制设置",
    columns: [
      { name: "id", definition: "VARCHAR(191) PRIMARY KEY NOT NULL", comment: "设置行唯一标识，当前为 default" },
      { name: "allow_registration", definition: "TINYINT NOT NULL DEFAULT 1", comment: "是否允许用户注册" },
      { name: "require_approval", definition: "TINYINT NOT NULL DEFAULT 0", comment: "注册后是否需要管理员审核" },
      { name: "default_credits", definition: "INT NOT NULL DEFAULT 10", comment: "新注册用户默认积分" },
      {
        name: "generation_credit_cost",
        definition: `INT NOT NULL DEFAULT ${DEFAULT_GENERATION_CREDIT_COST}`,
        comment: "每张生成图片消耗积分"
      },
      { name: "checkin_credit", definition: `INT NOT NULL DEFAULT ${DEFAULT_CHECKIN_CREDIT}`, comment: "每日签到奖励积分" },
      {
        name: "max_images_per_request",
        definition: `INT NOT NULL DEFAULT ${DEFAULT_MAX_IMAGES_PER_REQUEST}`,
        comment: "单次生成请求最大图片数量"
      },
      { name: "created_at", definition: "VARCHAR(32) NOT NULL", comment: "创建时间 ISO 字符串" },
      { name: "updated_at", definition: "VARCHAR(32) NOT NULL", comment: "更新时间 ISO 字符串" }
    ],
    constraints: []
  },
  {
    name: "credit_transactions",
    comment: "积分余额变更不可变审计流水",
    columns: [
      { name: "id", definition: "VARCHAR(191) PRIMARY KEY NOT NULL", comment: "积分流水唯一标识" },
      { name: "user_id", definition: "VARCHAR(191) NOT NULL", comment: "积分所属用户 ID" },
      { name: "delta", definition: "INT NOT NULL", comment: "积分变更值，正数增加，负数扣减" },
      { name: "reason", definition: "VARCHAR(64) NOT NULL", comment: "积分变更原因" },
      { name: "related_generation_id", definition: "VARCHAR(191)", comment: "关联生成记录 ID" },
      { name: "related_output_id", definition: "VARCHAR(191)", comment: "关联生成输出 ID" },
      { name: "related_checkin_date", definition: "VARCHAR(32)", comment: "关联签到日期键" },
      { name: "related_redemption_code_id", definition: "VARCHAR(191)", comment: "关联兑换码 ID" },
      { name: "admin_note", definition: "TEXT", comment: "管理员手动调整备注" },
      { name: "created_at", definition: "VARCHAR(32) NOT NULL", comment: "创建时间 ISO 字符串" }
    ],
    constraints: [
      "KEY credit_transactions_user_id_idx (user_id)",
      "UNIQUE KEY credit_transactions_generation_reason_idx (related_generation_id, reason)",
      "CONSTRAINT credit_transactions_user_fk FOREIGN KEY (user_id) REFERENCES users(id)"
    ]
  },
  {
    name: "user_checkins",
    comment: "用户每日签到奖励记录",
    columns: [
      { name: "user_id", definition: "VARCHAR(191) NOT NULL", comment: "签到用户 ID" },
      { name: "checkin_date", definition: "VARCHAR(32) NOT NULL", comment: "本地日期键 YYYY-MM-DD" },
      { name: "credits_awarded", definition: "INT NOT NULL", comment: "本次签到奖励积分" },
      { name: "created_at", definition: "VARCHAR(32) NOT NULL", comment: "创建时间 ISO 字符串" }
    ],
    constraints: [
      "PRIMARY KEY (user_id, checkin_date)",
      "KEY user_checkins_user_id_idx (user_id)",
      "CONSTRAINT user_checkins_user_fk FOREIGN KEY (user_id) REFERENCES users(id)"
    ]
  },
  {
    name: "redemption_codes",
    comment: "后台生成的积分兑换码",
    columns: [
      { name: "id", definition: "VARCHAR(191) PRIMARY KEY NOT NULL", comment: "兑换码记录唯一标识" },
      { name: "code", definition: "VARCHAR(64) NOT NULL", comment: "兑换码码值" },
      { name: "credits", definition: "INT NOT NULL", comment: "兑换后发放积分" },
      { name: "status", definition: "VARCHAR(32) NOT NULL", comment: "兑换码状态，active 或 disabled" },
      { name: "expires_at", definition: "VARCHAR(32)", comment: "过期时间 ISO 字符串，空表示永久有效" },
      { name: "redeemed_by_user_id", definition: "VARCHAR(191)", comment: "成功兑换用户 ID" },
      { name: "redeemed_at", definition: "VARCHAR(32)", comment: "成功兑换时间 ISO 字符串" },
      { name: "created_by_admin_id", definition: "VARCHAR(191)", comment: "创建管理员 ID" },
      { name: "created_at", definition: "VARCHAR(32) NOT NULL", comment: "创建时间 ISO 字符串" },
      { name: "updated_at", definition: "VARCHAR(32) NOT NULL", comment: "更新时间 ISO 字符串" }
    ],
    constraints: [
      "UNIQUE KEY redemption_codes_code_idx (code)",
      "KEY redemption_codes_status_idx (status)",
      "KEY redemption_codes_redeemed_by_user_id_idx (redeemed_by_user_id)",
      "KEY redemption_codes_created_at_idx (created_at)",
      "CONSTRAINT redemption_codes_redeemed_user_fk FOREIGN KEY (redeemed_by_user_id) REFERENCES users(id)",
      "CONSTRAINT redemption_codes_admin_fk FOREIGN KEY (created_by_admin_id) REFERENCES users(id)"
    ]
  },
  {
    name: "credit_redemptions",
    comment: "兑换码成功兑换审计记录",
    columns: [
      { name: "id", definition: "VARCHAR(191) PRIMARY KEY NOT NULL", comment: "兑换记录唯一标识" },
      { name: "code_id", definition: "VARCHAR(191) NOT NULL", comment: "兑换码记录 ID" },
      { name: "user_id", definition: "VARCHAR(191) NOT NULL", comment: "兑换用户 ID" },
      { name: "credits_awarded", definition: "INT NOT NULL", comment: "本次发放积分" },
      { name: "transaction_id", definition: "VARCHAR(191) NOT NULL", comment: "对应积分流水 ID" },
      { name: "created_at", definition: "VARCHAR(32) NOT NULL", comment: "创建时间 ISO 字符串" }
    ],
    constraints: [
      "UNIQUE KEY credit_redemptions_code_id_idx (code_id)",
      "KEY credit_redemptions_user_id_idx (user_id)",
      "KEY credit_redemptions_transaction_id_idx (transaction_id)",
      "CONSTRAINT credit_redemptions_code_fk FOREIGN KEY (code_id) REFERENCES redemption_codes(id)",
      "CONSTRAINT credit_redemptions_user_fk FOREIGN KEY (user_id) REFERENCES users(id)",
      "CONSTRAINT credit_redemptions_transaction_fk FOREIGN KEY (transaction_id) REFERENCES credit_transactions(id)"
    ]
  },
  {
    name: "projects",
    comment: "保存的 tldraw 项目快照",
    columns: [
      { name: "id", definition: "VARCHAR(191) PRIMARY KEY NOT NULL", comment: "项目唯一标识" },
      { name: "user_id", definition: "VARCHAR(191)", comment: "项目所属用户 ID" },
      { name: "name", definition: "TEXT NOT NULL", comment: "项目名称" },
      { name: "snapshot_json", definition: "LONGTEXT NOT NULL", comment: "序列化项目快照 JSON" },
      { name: "created_at", definition: "VARCHAR(32) NOT NULL", comment: "创建时间 ISO 字符串" },
      { name: "updated_at", definition: "VARCHAR(32) NOT NULL", comment: "更新时间 ISO 字符串" }
    ],
    constraints: ["KEY projects_user_id_idx (user_id)"]
  },
  {
    name: "assets",
    comment: "本地生成图和参考图资产元数据",
    columns: [
      { name: "id", definition: "VARCHAR(191) PRIMARY KEY NOT NULL", comment: "资产唯一标识" },
      { name: "user_id", definition: "VARCHAR(191)", comment: "资产所属用户 ID" },
      { name: "file_name", definition: "TEXT NOT NULL", comment: "存储文件名" },
      { name: "relative_path", definition: "TEXT NOT NULL", comment: "相对 DATA_DIR 的资产路径" },
      { name: "mime_type", definition: "VARCHAR(191) NOT NULL", comment: "资产 MIME 类型" },
      { name: "width", definition: "INT NOT NULL", comment: "图片宽度像素" },
      { name: "height", definition: "INT NOT NULL", comment: "图片高度像素" },
      { name: "created_at", definition: "VARCHAR(32) NOT NULL", comment: "创建时间 ISO 字符串" }
    ],
    constraints: ["KEY assets_user_id_idx (user_id)"]
  },
  {
    name: "provider_configs",
    comment: "图片生成提供方顺序和本地 OpenAI 兼容配置",
    columns: [
      { name: "id", definition: "VARCHAR(191) PRIMARY KEY NOT NULL", comment: "配置行唯一标识，当前为 active" },
      { name: "source_order_json", definition: "TEXT NOT NULL", comment: "提供方来源顺序 JSON" },
      { name: "local_api_key", definition: "TEXT", comment: "本地 OpenAI 兼容 API Key" },
      { name: "local_base_url", definition: "TEXT", comment: "本地 OpenAI 兼容 Base URL" },
      { name: "local_model", definition: "TEXT", comment: "本地图片生成模型" },
      { name: "local_timeout_ms", definition: "INT", comment: "本地提供方超时时间毫秒" },
      { name: "created_at", definition: "VARCHAR(32) NOT NULL", comment: "创建时间 ISO 字符串" },
      { name: "updated_at", definition: "VARCHAR(32) NOT NULL", comment: "更新时间 ISO 字符串" }
    ],
    constraints: []
  },
  {
    name: "agent_llm_configs",
    comment: "Agent 规划模型连接配置",
    columns: [
      { name: "id", definition: "VARCHAR(191) PRIMARY KEY NOT NULL", comment: "配置行唯一标识，当前为 active" },
      { name: "api_key", definition: "TEXT", comment: "Agent LLM API Key" },
      { name: "base_url", definition: "TEXT NOT NULL", comment: "Agent LLM OpenAI 兼容 Base URL" },
      { name: "model", definition: "TEXT NOT NULL", comment: "Agent 规划模型名称" },
      { name: "timeout_ms", definition: "INT NOT NULL", comment: "Agent LLM 请求超时时间毫秒" },
      { name: "supports_vision", definition: "TINYINT NOT NULL", comment: "模型是否支持视觉输入" },
      { name: "created_at", definition: "VARCHAR(32) NOT NULL", comment: "创建时间 ISO 字符串" },
      { name: "updated_at", definition: "VARCHAR(32) NOT NULL", comment: "更新时间 ISO 字符串" }
    ],
    constraints: []
  },
  {
    name: "agent_conversations",
    comment: "Agent 对话历史和可恢复上下文",
    columns: [
      { name: "id", definition: "VARCHAR(191) PRIMARY KEY NOT NULL", comment: "Agent 对话唯一标识" },
      { name: "user_id", definition: "VARCHAR(191)", comment: "对话所属用户 ID" },
      { name: "title", definition: "TEXT NOT NULL", comment: "对话标题" },
      { name: "messages_json", definition: "LONGTEXT NOT NULL", comment: "Agent 消息记录 JSON" },
      { name: "context_json", definition: "LONGTEXT NOT NULL", comment: "Agent 可恢复上下文 JSON" },
      { name: "created_at", definition: "VARCHAR(32) NOT NULL", comment: "创建时间 ISO 字符串" },
      { name: "updated_at", definition: "VARCHAR(32) NOT NULL", comment: "更新时间 ISO 字符串" }
    ],
    constraints: ["KEY agent_conversations_user_id_idx (user_id)", "KEY agent_conversations_updated_at_idx (updated_at)"]
  },
  {
    name: "agent_skills",
    comment: "Agent 本地技能库条目和文件内容",
    columns: [
      { name: "id", definition: "VARCHAR(191) PRIMARY KEY NOT NULL", comment: "技能唯一标识" },
      { name: "slug", definition: "VARCHAR(191) NOT NULL", comment: "技能稳定 slug" },
      { name: "name", definition: "TEXT NOT NULL", comment: "技能展示名称" },
      { name: "description", definition: "TEXT NOT NULL", comment: "技能摘要说明" },
      { name: "version", definition: "TEXT", comment: "技能版本" },
      { name: "source", definition: "TEXT", comment: "技能来源 URL 或说明" },
      { name: "enabled", definition: "TINYINT NOT NULL", comment: "技能是否启用" },
      { name: "built_in", definition: "TINYINT NOT NULL", comment: "是否为内置技能" },
      { name: "is_required", definition: "TINYINT NOT NULL", comment: "是否为必需技能" },
      { name: "trigger_mode", definition: "VARCHAR(32) NOT NULL", comment: "触发模式，always 或 auto" },
      { name: "trigger_keywords_json", definition: "TEXT NOT NULL", comment: "自动触发关键词 JSON" },
      { name: "files_json", definition: "LONGTEXT NOT NULL", comment: "技能文件内容 JSON" },
      { name: "created_at", definition: "VARCHAR(32) NOT NULL", comment: "创建时间 ISO 字符串" },
      { name: "updated_at", definition: "VARCHAR(32) NOT NULL", comment: "更新时间 ISO 字符串" }
    ],
    constraints: ["UNIQUE KEY agent_skills_slug_idx (slug)"]
  },
  {
    name: "prompt_favorite_groups",
    comment: "用户提示词收藏分组",
    columns: [
      { name: "id", definition: "VARCHAR(191) PRIMARY KEY NOT NULL", comment: "收藏分组唯一标识" },
      { name: "user_id", definition: "VARCHAR(191)", comment: "分组所属用户 ID" },
      { name: "name", definition: "TEXT NOT NULL", comment: "收藏分组名称" },
      { name: "sort_order", definition: "INT NOT NULL", comment: "分组排序值" },
      { name: "created_at", definition: "VARCHAR(32) NOT NULL", comment: "创建时间 ISO 字符串" },
      { name: "updated_at", definition: "VARCHAR(32) NOT NULL", comment: "更新时间 ISO 字符串" }
    ],
    constraints: ["KEY prompt_favorite_groups_user_id_idx (user_id)"]
  },
  {
    name: "prompt_favorites",
    comment: "用户收藏的提示词引用",
    columns: [
      { name: "id", definition: "VARCHAR(191) PRIMARY KEY NOT NULL", comment: "收藏记录唯一标识" },
      { name: "user_id", definition: "VARCHAR(191)", comment: "收藏所属用户 ID" },
      { name: "source_type", definition: "VARCHAR(64) NOT NULL", comment: "收藏来源类型" },
      { name: "source_id", definition: "VARCHAR(191) NOT NULL", comment: "收藏来源 ID" },
      { name: "group_id", definition: "VARCHAR(191) NOT NULL", comment: "收藏分组 ID" },
      { name: "title", definition: "TEXT NOT NULL", comment: "收藏标题" },
      { name: "prompt", definition: "LONGTEXT NOT NULL", comment: "提示词正文" },
      { name: "model", definition: "TEXT NOT NULL", comment: "来源模型标签" },
      { name: "media_type", definition: "VARCHAR(32) NOT NULL", comment: "媒体类型" },
      { name: "asset_url", definition: "TEXT NOT NULL", comment: "来源资产 URL" },
      { name: "image_width", definition: "INT", comment: "来源图片宽度像素" },
      { name: "image_height", definition: "INT", comment: "来源图片高度像素" },
      { name: "source_url", definition: "TEXT", comment: "来源页面 URL" },
      { name: "use_count", definition: "INT NOT NULL DEFAULT 0", comment: "收藏使用次数" },
      { name: "last_used_at", definition: "VARCHAR(32)", comment: "最近使用时间 ISO 字符串" },
      { name: "created_at", definition: "VARCHAR(32) NOT NULL", comment: "创建时间 ISO 字符串" },
      { name: "updated_at", definition: "VARCHAR(32) NOT NULL", comment: "更新时间 ISO 字符串" }
    ],
    constraints: [
      "KEY prompt_favorites_user_id_idx (user_id)",
      "UNIQUE KEY prompt_favorites_user_source_idx (user_id, source_type, source_id)",
      "KEY prompt_favorites_group_id_idx (group_id)",
      "KEY prompt_favorites_last_used_at_idx (last_used_at)",
      "CONSTRAINT prompt_favorites_group_fk FOREIGN KEY (group_id) REFERENCES prompt_favorite_groups(id)"
    ]
  },
  {
    name: "codex_oauth_tokens",
    comment: "本地 Codex OAuth 会话状态",
    columns: [
      { name: "id", definition: "VARCHAR(191) PRIMARY KEY NOT NULL", comment: "OAuth 记录唯一标识" },
      { name: "access_token", definition: "TEXT", comment: "访问令牌密文或原始本地令牌" },
      { name: "refresh_token", definition: "TEXT", comment: "刷新令牌密文或原始本地令牌" },
      { name: "id_token", definition: "TEXT", comment: "身份令牌" },
      { name: "email", definition: "TEXT", comment: "关联账号邮箱" },
      { name: "account_id", definition: "TEXT", comment: "关联账号 ID" },
      { name: "expires_at", definition: "VARCHAR(32)", comment: "令牌过期时间 ISO 字符串" },
      { name: "refreshed_at", definition: "VARCHAR(32)", comment: "最近刷新时间 ISO 字符串" },
      { name: "unavailable_at", definition: "VARCHAR(32)", comment: "登录态不可用时间 ISO 字符串" },
      { name: "unavailable_reason", definition: "TEXT", comment: "登录态不可用原因" },
      { name: "created_at", definition: "VARCHAR(32) NOT NULL", comment: "创建时间 ISO 字符串" },
      { name: "updated_at", definition: "VARCHAR(32) NOT NULL", comment: "更新时间 ISO 字符串" }
    ],
    constraints: []
  },
  {
    name: "generation_records",
    comment: "图片生成请求及整体状态",
    columns: [
      { name: "id", definition: "VARCHAR(191) PRIMARY KEY NOT NULL", comment: "生成请求唯一标识" },
      { name: "user_id", definition: "VARCHAR(191)", comment: "生成请求所属用户 ID" },
      { name: "mode", definition: "VARCHAR(32) NOT NULL", comment: "生成模式" },
      { name: "prompt", definition: "LONGTEXT NOT NULL", comment: "用户原始提示词" },
      { name: "effective_prompt", definition: "LONGTEXT NOT NULL", comment: "套用预设后的有效提示词" },
      { name: "preset_id", definition: "VARCHAR(191) NOT NULL", comment: "图片风格预设 ID" },
      { name: "width", definition: "INT NOT NULL", comment: "请求输出宽度像素" },
      { name: "height", definition: "INT NOT NULL", comment: "请求输出高度像素" },
      { name: "quality", definition: "VARCHAR(32) NOT NULL", comment: "请求图片质量" },
      { name: "output_format", definition: "VARCHAR(32) NOT NULL", comment: "请求输出格式" },
      { name: "count", definition: "INT NOT NULL", comment: "请求生成图片数量" },
      { name: "status", definition: "VARCHAR(32) NOT NULL", comment: "生成请求状态" },
      { name: "error", definition: "TEXT", comment: "生成请求错误摘要" },
      { name: "reference_asset_id", definition: "VARCHAR(191)", comment: "旧版单参考资产 ID" },
      { name: "created_at", definition: "VARCHAR(32) NOT NULL", comment: "创建时间 ISO 字符串" }
    ],
    constraints: [
      "KEY generation_records_user_id_idx (user_id)",
      "KEY generation_records_created_at_idx (created_at)",
      "KEY generation_records_reference_asset_idx (reference_asset_id)",
      "CONSTRAINT generation_records_reference_asset_fk FOREIGN KEY (reference_asset_id) REFERENCES assets(id) ON DELETE SET NULL"
    ]
  },
  {
    name: "generation_outputs",
    comment: "单个生成输出状态和资产关联",
    columns: [
      { name: "id", definition: "VARCHAR(191) PRIMARY KEY NOT NULL", comment: "生成输出唯一标识" },
      { name: "user_id", definition: "VARCHAR(191)", comment: "生成输出所属用户 ID" },
      { name: "generation_id", definition: "VARCHAR(191) NOT NULL", comment: "所属生成请求 ID" },
      { name: "status", definition: "VARCHAR(32) NOT NULL", comment: "输出状态" },
      { name: "asset_id", definition: "VARCHAR(191)", comment: "成功输出关联资产 ID" },
      { name: "error", definition: "TEXT", comment: "单个输出错误摘要" },
      { name: "is_public", definition: "TINYINT NOT NULL DEFAULT 0", comment: "是否公开到 Gallery" },
      { name: "published_at", definition: "VARCHAR(32)", comment: "公开发布时间 ISO 字符串" },
      { name: "public_title", definition: "TEXT", comment: "公开 Gallery 展示标题" },
      { name: "created_at", definition: "VARCHAR(32) NOT NULL", comment: "创建时间 ISO 字符串" }
    ],
    constraints: [
      "KEY generation_outputs_user_id_idx (user_id)",
      "KEY generation_outputs_generation_id_idx (generation_id)",
      "KEY generation_outputs_asset_id_idx (asset_id)",
      "KEY generation_outputs_public_idx (is_public, published_at)",
      "CONSTRAINT generation_outputs_generation_fk FOREIGN KEY (generation_id) REFERENCES generation_records(id) ON DELETE CASCADE",
      "CONSTRAINT generation_outputs_asset_fk FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE SET NULL"
    ]
  },
  {
    name: "generation_audits",
    comment: "管理员查看的生成请求审计快照",
    columns: [
      { name: "id", definition: "VARCHAR(191) PRIMARY KEY NOT NULL", comment: "审计记录唯一标识" },
      { name: "generation_id", definition: "VARCHAR(191) NOT NULL", comment: "关联生成请求 ID" },
      { name: "user_id", definition: "VARCHAR(191)", comment: "请求用户 ID 快照" },
      { name: "user_name", definition: "TEXT", comment: "请求用户名称快照" },
      { name: "user_email", definition: "VARCHAR(254)", comment: "请求用户邮箱快照" },
      { name: "mode", definition: "VARCHAR(32) NOT NULL", addDefinition: "VARCHAR(32) NOT NULL DEFAULT 'generate'", comment: "生成模式快照" },
      { name: "prompt", definition: "LONGTEXT NOT NULL", comment: "原始用户提示词快照" },
      { name: "is_public", definition: "TINYINT NOT NULL DEFAULT 0", comment: "请求或输出公开状态快照" },
      { name: "status", definition: "VARCHAR(32) NOT NULL", addDefinition: "VARCHAR(32) NOT NULL DEFAULT 'running'", comment: "生成状态快照" },
      { name: "error_summary", definition: "TEXT", comment: "已清洗错误摘要" },
      { name: "ip_address", definition: "VARCHAR(191)", comment: "请求 IP 摘要" },
      { name: "user_agent", definition: "TEXT", comment: "请求 User-Agent 摘要" },
      { name: "outputs_json", definition: "LONGTEXT NOT NULL", comment: "输出关联快照 JSON" },
      { name: "created_at", definition: "VARCHAR(32) NOT NULL", comment: "创建时间 ISO 字符串" },
      { name: "updated_at", definition: "VARCHAR(32) NOT NULL", comment: "更新时间 ISO 字符串" }
    ],
    constraints: [
      "UNIQUE KEY generation_audits_generation_id_idx (generation_id)",
      "KEY generation_audits_created_at_idx (created_at)",
      "KEY generation_audits_user_id_idx (user_id)"
    ]
  },
  {
    name: "generation_reference_assets",
    comment: "一次生成请求使用的多参考资产",
    columns: [
      { name: "generation_id", definition: "VARCHAR(191) NOT NULL", comment: "所属生成请求 ID" },
      { name: "asset_id", definition: "VARCHAR(191) NOT NULL", comment: "参考资产 ID" },
      { name: "position", definition: "INT NOT NULL", comment: "参考资产顺序" },
      { name: "created_at", definition: "VARCHAR(32) NOT NULL", comment: "创建时间 ISO 字符串" }
    ],
    constraints: [
      "PRIMARY KEY (generation_id, position)",
      "KEY generation_reference_assets_generation_id_idx (generation_id)",
      "KEY generation_reference_assets_asset_id_idx (asset_id)",
      "CONSTRAINT generation_reference_assets_generation_fk FOREIGN KEY (generation_id) REFERENCES generation_records(id) ON DELETE CASCADE",
      "CONSTRAINT generation_reference_assets_asset_fk FOREIGN KEY (asset_id) REFERENCES assets(id)"
    ]
  }
];

export async function createMySqlDatabase(config: MySqlDatabaseConfig): Promise<MySqlDatabaseContext> {
  ensureRuntimeStorage();

  if (config.createDatabase) {
    await ensureDatabase(config);
  }

  const pool = mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    charset: "utf8mb4",
    waitForConnections: true,
    connectionLimit: config.connectionLimit,
    multipleStatements: false
  });

  await migrateMySql(pool);

  return {
    driver: "mysql",
    pool,
    close: () => pool.end()
  };
}

async function ensureDatabase(config: MySqlDatabaseConfig): Promise<void> {
  const connection = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    charset: "utf8mb4",
    multipleStatements: false
  });

  try {
    await connection.query(`CREATE DATABASE IF NOT EXISTS ${quoteIdentifier(config.database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } finally {
    await connection.end();
  }
}

function quoteIdentifier(value: string): string {
  if (!/^[A-Za-z0-9_$]+$/u.test(value)) {
    throw new Error("MySQL identifiers may only contain letters, numbers, underscores, and dollar signs.");
  }

  return `\`${value}\``;
}

function quoteSqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function migrateMySql(pool: Pool): Promise<void> {
  for (const statement of schemaStatements()) {
    await pool.query(statement);
  }

  await ensureOwnerColumns(pool);
  await ensureMySqlSchemaComments(pool);
  await backfillGenerationReferenceAssets(pool);
  await ensureProviderConfigRow(pool);
  await ensureAgentLlmConfigRow(pool);
  await ensureAppSettingsRow(pool);
  await ensurePromptFavoriteDefaultGroup(pool);
}

function schemaStatements(): string[] {
  return mySqlSchema.map((table) => {
    const entries = [...table.columns.map((column) => columnStatement(column)), ...table.constraints];
    return `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(table.name)} (
      ${entries.join(",\n      ")}
    ) ${tableOptions} COMMENT=${quoteSqlString(table.comment)}`;
  });
}

function columnStatement(column: MySqlColumnDefinition, options: { omitPrimaryKey?: boolean; useAddDefinition?: boolean } = {}): string {
  const rawDefinition = options.useAddDefinition ? (column.addDefinition ?? column.definition) : column.definition;
  const definition = options.omitPrimaryKey ? rawDefinition.replace(/\s+PRIMARY KEY/u, "") : rawDefinition;
  return `${quoteIdentifier(column.name)} ${definition} COMMENT ${quoteSqlString(column.comment)}`;
}

function findColumnDefinition(tableName: string, columnName: string): MySqlColumnDefinition {
  const table = mySqlSchema.find((candidate) => candidate.name === tableName);
  const column = table?.columns.find((candidate) => candidate.name === columnName);
  if (!column) {
    throw new Error(`Missing MySQL schema definition for ${tableName}.${columnName}.`);
  }

  return column;
}

async function ensureOwnerColumns(pool: Pool): Promise<void> {
  await ensureMySqlColumn(pool, "projects", "user_id");
  await ensureMySqlColumn(pool, "assets", "user_id");
  await ensureMySqlColumn(pool, "generation_records", "user_id");
  await ensureMySqlColumn(pool, "generation_outputs", "user_id");
  await ensureMySqlColumn(pool, "generation_outputs", "is_public");
  await ensureMySqlColumn(pool, "generation_outputs", "published_at");
  await ensureMySqlColumn(pool, "generation_outputs", "public_title");
  await ensureMySqlColumn(pool, "generation_audits", "generation_id");
  await ensureMySqlColumn(pool, "generation_audits", "user_id");
  await ensureMySqlColumn(pool, "generation_audits", "user_name");
  await ensureMySqlColumn(pool, "generation_audits", "user_email");
  await ensureMySqlColumn(pool, "generation_audits", "mode");
  await ensureMySqlColumn(pool, "generation_audits", "prompt");
  await ensureMySqlColumn(pool, "generation_audits", "is_public");
  await ensureMySqlColumn(pool, "generation_audits", "status");
  await ensureMySqlColumn(pool, "generation_audits", "error_summary");
  await ensureMySqlColumn(pool, "generation_audits", "ip_address");
  await ensureMySqlColumn(pool, "generation_audits", "user_agent");
  await ensureMySqlColumn(pool, "generation_audits", "outputs_json");
  await ensureMySqlColumn(pool, "generation_audits", "created_at");
  await ensureMySqlColumn(pool, "generation_audits", "updated_at");
  await ensureMySqlColumn(pool, "app_settings", "generation_credit_cost");
  await ensureMySqlColumn(pool, "app_settings", "checkin_credit");
  await ensureMySqlColumn(pool, "app_settings", "max_images_per_request");
  await ensureMySqlColumn(pool, "credit_transactions", "related_redemption_code_id");
  await ensureMySqlColumn(pool, "agent_conversations", "user_id");
  await ensureMySqlColumn(pool, "prompt_favorite_groups", "user_id");
  await ensureMySqlColumn(pool, "prompt_favorites", "user_id");
  await ensureMySqlIndex(pool, "projects", "projects_user_id_idx", "user_id");
  await ensureMySqlIndex(pool, "assets", "assets_user_id_idx", "user_id");
  await ensureMySqlIndex(pool, "generation_records", "generation_records_user_id_idx", "user_id");
  await ensureMySqlIndex(pool, "generation_outputs", "generation_outputs_user_id_idx", "user_id");
  await ensureMySqlCompositeIndex(pool, "generation_outputs", "generation_outputs_public_idx", ["is_public", "published_at"]);
  await ensureMySqlUniqueIndex(pool, "generation_audits", "generation_audits_generation_id_idx", "generation_id");
  await ensureMySqlIndex(pool, "generation_audits", "generation_audits_created_at_idx", "created_at");
  await ensureMySqlIndex(pool, "generation_audits", "generation_audits_user_id_idx", "user_id");
  await ensureMySqlIndex(pool, "credit_transactions", "credit_transactions_user_id_idx", "user_id");
  await ensureMySqlCompositeIndex(pool, "credit_transactions", "credit_transactions_generation_reason_idx", [
    "related_generation_id",
    "reason"
  ]);
  await ensureMySqlIndex(pool, "user_checkins", "user_checkins_user_id_idx", "user_id");
  await ensureMySqlUniqueIndex(pool, "redemption_codes", "redemption_codes_code_idx", "code");
  await ensureMySqlIndex(pool, "redemption_codes", "redemption_codes_status_idx", "status");
  await ensureMySqlIndex(pool, "redemption_codes", "redemption_codes_redeemed_by_user_id_idx", "redeemed_by_user_id");
  await ensureMySqlIndex(pool, "redemption_codes", "redemption_codes_created_at_idx", "created_at");
  await ensureMySqlUniqueIndex(pool, "credit_redemptions", "credit_redemptions_code_id_idx", "code_id");
  await ensureMySqlIndex(pool, "credit_redemptions", "credit_redemptions_user_id_idx", "user_id");
  await ensureMySqlIndex(pool, "credit_redemptions", "credit_redemptions_transaction_id_idx", "transaction_id");
  await ensureMySqlIndex(pool, "agent_conversations", "agent_conversations_user_id_idx", "user_id");
  await ensureMySqlIndex(pool, "prompt_favorite_groups", "prompt_favorite_groups_user_id_idx", "user_id");
  await ensureMySqlIndex(pool, "prompt_favorites", "prompt_favorites_user_id_idx", "user_id");
  await ensurePromptFavoritesUserSourceIndex(pool);
}

async function ensureMySqlColumn(pool: Pool, tableName: string, columnName: string): Promise<void> {
  const column = findColumnDefinition(tableName, columnName);
  const [rows] = await pool.execute<Array<{ columnName: string } & RowDataPacket>>(
    `SELECT COLUMN_NAME AS columnName
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [tableName, columnName]
  );
  if (rows.length > 0) {
    return;
  }

  await pool.query(`ALTER TABLE ${quoteIdentifier(tableName)} ADD COLUMN ${columnStatement(column, { useAddDefinition: true })}`);
}

async function ensureMySqlSchemaComments(pool: Pool): Promise<void> {
  for (const table of mySqlSchema) {
    await ensureMySqlTableComment(pool, table);
    for (const column of table.columns) {
      await ensureMySqlColumnComment(pool, table.name, column);
    }
  }
}

async function ensureMySqlTableComment(pool: Pool, table: MySqlTableDefinition): Promise<void> {
  const [rows] = await pool.execute<Array<{ tableComment: string } & RowDataPacket>>(
    `SELECT TABLE_COMMENT AS tableComment
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
     LIMIT 1`,
    [table.name]
  );
  if (rows[0]?.tableComment === table.comment) {
    return;
  }

  await pool.query(`ALTER TABLE ${quoteIdentifier(table.name)} COMMENT = ${quoteSqlString(table.comment)}`);
}

async function ensureMySqlColumnComment(
  pool: Pool,
  tableName: string,
  column: MySqlColumnDefinition
): Promise<void> {
  const [rows] = await pool.execute<Array<{ columnComment: string } & RowDataPacket>>(
    `SELECT COLUMN_COMMENT AS columnComment
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [tableName, column.name]
  );
  if (rows[0]?.columnComment === column.comment) {
    return;
  }

  await pool.query(`ALTER TABLE ${quoteIdentifier(tableName)} MODIFY COLUMN ${columnStatement(column, { omitPrimaryKey: true })}`);
}

async function ensureMySqlIndex(pool: Pool, tableName: string, indexName: string, columnName: string): Promise<void> {
  const [rows] = await pool.execute<Array<{ indexName: string } & RowDataPacket>>(
    `SELECT INDEX_NAME AS indexName
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND INDEX_NAME = ?`,
    [tableName, indexName]
  );
  if (rows.length > 0) {
    return;
  }

  await pool.query(`CREATE INDEX ${quoteIdentifier(indexName)} ON ${quoteIdentifier(tableName)} (${quoteIdentifier(columnName)})`);
}

async function ensureMySqlUniqueIndex(pool: Pool, tableName: string, indexName: string, columnName: string): Promise<void> {
  if (await mySqlIndexExists(pool, tableName, indexName)) {
    return;
  }

  await pool.query(`CREATE UNIQUE INDEX ${quoteIdentifier(indexName)} ON ${quoteIdentifier(tableName)} (${quoteIdentifier(columnName)})`);
}

async function ensureMySqlCompositeIndex(
  pool: Pool,
  tableName: string,
  indexName: string,
  columnNames: string[]
): Promise<void> {
  if (await mySqlIndexExists(pool, tableName, indexName)) {
    return;
  }

  await pool.query(
    `CREATE INDEX ${quoteIdentifier(indexName)} ON ${quoteIdentifier(tableName)}
       (${columnNames.map((columnName) => quoteIdentifier(columnName)).join(", ")})`
  );
}

async function ensurePromptFavoritesUserSourceIndex(pool: Pool): Promise<void> {
  if (await mySqlIndexExists(pool, "prompt_favorites", "prompt_favorites_source_idx")) {
    await pool.query(
      `ALTER TABLE ${quoteIdentifier("prompt_favorites")}
       DROP INDEX ${quoteIdentifier("prompt_favorites_source_idx")}`
    );
  }

  if (await mySqlIndexExists(pool, "prompt_favorites", "prompt_favorites_user_source_idx")) {
    return;
  }

  await pool.query(
    `CREATE UNIQUE INDEX ${quoteIdentifier("prompt_favorites_user_source_idx")}
     ON ${quoteIdentifier("prompt_favorites")}
       (${quoteIdentifier("user_id")}, ${quoteIdentifier("source_type")}, ${quoteIdentifier("source_id")})`
  );
}

async function mySqlIndexExists(pool: Pool, tableName: string, indexName: string): Promise<boolean> {
  const [rows] = await pool.execute<Array<{ indexName: string } & RowDataPacket>>(
    `SELECT INDEX_NAME AS indexName
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND INDEX_NAME = ?
     LIMIT 1`,
    [tableName, indexName]
  );
  return rows.length > 0;
}

async function backfillGenerationReferenceAssets(pool: Pool): Promise<void> {
  await pool.query(`
    INSERT IGNORE INTO generation_reference_assets (generation_id, asset_id, position, created_at)
    SELECT generation_records.id, generation_records.reference_asset_id, 0, generation_records.created_at
    FROM generation_records
    WHERE generation_records.reference_asset_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM assets
        WHERE assets.id = generation_records.reference_asset_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM generation_reference_assets
        WHERE generation_reference_assets.generation_id = generation_records.id
      )
  `);
}

async function ensureProviderConfigRow(pool: Pool): Promise<void> {
  const now = new Date().toISOString();
  await pool.execute(
    `INSERT IGNORE INTO provider_configs (id, source_order_json, created_at, updated_at)
     VALUES (?, ?, ?, ?)`,
    ["active", JSON.stringify(["env-openai", "local-openai", "codex"]), now, now]
  );
}

async function ensureAgentLlmConfigRow(pool: Pool): Promise<void> {
  const now = new Date().toISOString();
  await pool.execute(
    `INSERT IGNORE INTO agent_llm_configs
      (id, api_key, base_url, model, timeout_ms, supports_vision, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ["active", null, "", "", 60000, 0, now, now]
  );
}

async function ensureAppSettingsRow(pool: Pool): Promise<void> {
  const now = new Date().toISOString();
  await pool.execute(
    `INSERT IGNORE INTO app_settings
      (id, allow_registration, require_approval, default_credits, generation_credit_cost, checkin_credit, max_images_per_request, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      "default",
      1,
      0,
      DEFAULT_REGISTRATION_CREDITS,
      DEFAULT_GENERATION_CREDIT_COST,
      DEFAULT_CHECKIN_CREDIT,
      DEFAULT_MAX_IMAGES_PER_REQUEST,
      now,
      now
    ]
  );
}

async function ensurePromptFavoriteDefaultGroup(pool: Pool): Promise<void> {
  const now = new Date().toISOString();
  await pool.execute(
    `INSERT IGNORE INTO prompt_favorite_groups (id, name, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    ["default", "常用", 0, now, now]
  );
}
