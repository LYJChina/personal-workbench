# LYJ Workbench 多模型 AI 网关设计

**日期：** 2026-08-25  
**状态：** 已确认，开始实施

## 目标

将现有 DeepSeek 专用配置和三套重复请求客户端迁移为微内核统一 AI 网关。网关支持两类协议：OpenAI 兼容协议和 Anthropic 原生协议。大模型对话、AI 润色、日报生成以及未来获得 `ai:use` 权限的插件都通过网关调用模型。

## 范围

本阶段交付：

- 多个模型服务连接的新增、编辑、删除、设为默认和连接测试。
- `openai` 与 `anthropic` 两种协议适配器。
- 现有 DeepSeek URL、模型和 `deepseek-api-key` 的无损迁移。
- AI 对话、AI 润色和日报生成统一使用默认模型服务。
- API Key 继续只存入本地加密保险箱，不返回网页或插件。
- Windows 与 macOS 使用完全相同的数据结构和运行路径。

本阶段不包含流式输出、图片输入、工具调用、按插件选择模型、自动故障转移、响应缓存、Token 费用统计或第三方插件 SDK。这些能力依赖本阶段的网关边界，可在后续独立实现。

## 架构

```text
AI 对话 / AI 润色 / 日报 / 未来第三方插件
                         |
                         v
                  Kernel AI Gateway
                         |
             +-----------+-----------+
             |                       |
             v                       v
   OpenAI-compatible adapter   Anthropic adapter
   POST /chat/completions      POST /messages
```

业务功能只传入统一消息和生成参数，不读取供应商配置或密钥。网关读取默认连接、从保险箱取出对应密钥、选择适配器、规范化错误，并只返回文本和实际模型名称。

## 数据模型与迁移

新增 `ai_connections` 表：

- `id`：稳定连接 ID。
- `name`：用户可见名称。
- `protocol`：`openai` 或 `anthropic`。
- `base_url`：服务 API 根地址。
- `model`：默认模型名称。
- `secret_name`：保险箱密钥名称，只在服务端使用。
- `is_default`：唯一默认连接标记。
- `created_at`、`updated_at`。

数据库升级时创建稳定连接 `legacy-deepseek`：名称为 `DeepSeek`，协议为 `openai`，URL 和模型读取原有 `deepseek.base_url` 与 `deepseek.model`，密钥继续引用 `deepseek-api-key`。迁移不解密、不复制也不删除旧密钥。

新连接使用 `ai-connection:<id>:api-key` 作为保险箱名称。删除连接时同时删除对应的新密钥；`legacy-deepseek` 也可以删除，但删除前必须有另一个默认连接，且旧密钥只在明确删除时移除。

## HTTP API

- `GET /api/settings/ai-connections`：列出连接，不返回密钥或 `secret_name`。
- `POST /api/settings/ai-connections`：创建连接并可同时保存 API Key。
- `PUT /api/settings/ai-connections/:id`：更新名称、协议、URL、模型和可选的新密钥。
- `DELETE /api/settings/ai-connections/:id`：删除非唯一连接。
- `PUT /api/settings/ai-connections/:id/default`：原子切换默认连接。
- `POST /api/settings/ai-connections/:id/test`：使用该连接发送最小请求。

原有 `/api/settings/deepseek` 和 `/api/settings/deepseek/test` 在本阶段保留为兼容入口，映射到 `legacy-deepseek`，避免旧页面或旧自动化突然失效。

## 协议适配

OpenAI 兼容适配器发送 Bearer Token、`model`、`messages`、`temperature` 和可选 `max_tokens`，读取 `choices[0].message.content`。

Anthropic 适配器发送 `x-api-key`、`anthropic-version: 2023-06-01`、`model`、`messages`、`max_tokens` 和 `temperature`。统一消息中的 `system` 内容合并到顶层 `system` 字段，读取响应中第一个非空 `text` 内容块。

两种适配器都使用 30 秒超时、禁止自动跟随重定向，并将认证、限流、超时和上游异常规范化为固定错误类别，任何错误都不得包含 API Key、响应正文或内部堆栈。

## 设置界面

“DeepSeek”区块改名为“模型服务”。页面显示所有连接卡片、协议、模型、默认状态和密钥配置状态。用户可以新增、编辑、删除、测试连接和设为默认。新增或编辑时 API Key 留空表示保持原值。

第一版所有 AI 功能使用同一个默认连接。切换默认连接后，新请求立即使用新服务，历史记录仍保留生成时返回的模型名称。

## 安全与故障处理

- 生产环境只允许 HTTPS API 地址；测试模式可显式允许本机 HTTP。
- URL 禁止用户名、密码、查询参数、片段、反斜线和隐式重定向。
- 默认连接的切换和删除约束由 SQLite 事务保证。
- 未配置密钥、保险箱未解锁或没有默认连接时，AI 功能返回固定的“请先配置模型服务”错误。
- 连接测试只返回固定状态，不暴露供应商响应正文。

## 验证

- 数据库迁移测试证明旧 DeepSeek 设置和密钥引用被保留。
- 适配器单元测试验证请求头、请求体、响应解析、超时和错误归类。
- 路由测试验证 CRUD、默认唯一性、密钥不回传和 URL 边界。
- 三个现有 AI 功能测试验证它们只通过网关调用。
- 设置页面测试覆盖新增、编辑、默认切换、测试和删除。
- 最终运行完整测试、类型检查、生产构建和差异检查。
