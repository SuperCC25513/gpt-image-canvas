# Product Sense Guide

Use this before changing product behavior, user flows, prompt planning, provider configuration, local storage, Gallery, or onboarding.

## Product Promise

`gpt-image-canvas` 是面向创作者的本地优先 AI 图像画布。它把 tldraw、GPT Image 2 或 OpenAI-compatible 图像提供方、本地 SQLite 存储、Agent 规划和本地资产管理整合到一个工作台中。

The product should help users move from intent to usable image assets without losing control of prompts, references, plans, outputs, or credentials.

## Primary Users

- Creators arranging generated images on an infinite canvas.
- Operators producing batches of marketing, ecommerce, product, or social visuals.
- Power users who need local history, provider control, and repeatable Agent plans.
- Developers running the app locally with `.env`, local provider settings, or Codex login.

## Product Principles

- Local first: project state, history, provider settings, generated assets, and optional credentials live on the user's machine.
- Creator control: every plan can be inspected before execution. Users decide when to execute, retry, cancel, rerun, download, or locate assets.
- Reference fidelity: when selected canvas images are used as references, preserve their subject, composition, and intended role unless the user asks otherwise.
- 信任优先于魔法：让当前提供方、凭据状态、资产保存状态、错误和缺失配置保持可见。
- Useful defaults: default generation settings should be fast enough to try and clear enough to upgrade to higher quality.
- 可恢复流程：失败任务、阻塞任务、本地资产保存失败和缺失提供方都应给出清晰的下一步。

## Core Workflows

### Prompt To Image

The manual flow should let users enter a prompt, choose size, quality, output format, count, and style preset, then place generated assets on the canvas. The generation history should preserve the request, effective prompt, outputs, and errors.

### Reference Image Editing

When the user selects canvas images and asks to edit, polish, add text, create variations, or redesign based on them, the app should treat selected images as the source of truth. Generated outputs should stay connected to their reference assets.

### Agent Planning

The Agent tab converts user intent into a strict `GenerationPlan`. Plans are drafts until confirmed. Good plans are inspectable, bounded, dependency-aware, and honest about required user input.

Important plan limits:

- Total images across all jobs must be 16 or fewer.
- Each generation job may use at most 3 resolved reference images.
- Dependency source jobs used downstream must produce exactly 1 output.
- Generated anchor jobs are visible canvas images and count against the cap.

### Gallery And Assets

Gallery 应让本地输出易于浏览、定位、下载、重跑和检查。本地资产文件是唯一可用性来源。用户主动公开的单张输出可以进入图片广场；未公开输出和其资产默认保持私密。

### Provider Configuration

Provider configuration is part of the product, not an admin afterthought. Users should understand the source order: environment OpenAI-compatible config, local OpenAI-compatible config, then Codex fallback. Agent LLM configuration is separate from image provider configuration.

## Anti-Patterns

- Do not hide provider or credential problems behind generic failure messages.
- Do not create Agent plans that imply execution already happened.
- Do not invent selected image contents when vision is not available.
- 不要因为其他位置发生提供方错误或本地保存错误而丢弃已经可用的本地资产。
- Do not make onboarding require credentials before the user can understand the app.
