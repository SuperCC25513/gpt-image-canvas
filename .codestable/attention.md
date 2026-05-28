# Attention

本文件是 CodeStable 技能启动必读的项目注意事项入口。所有 CodeStable 子技能开始工作前必须读取它。

## 项目碎片知识

<!-- cs-note managed: 用 cs-note 维护，新条目按下面分节追加 -->

### 编译与构建

### 运行与本地起服务

### 测试

- 依赖临时 SQLite 的 smoke 测试要显式设置 `USE_MYSQL=false`，否则本机 `.env` 若启用 MySQL 会连到全局运行库。

### 命令与脚本陷阱

### 路径与目录约定

### 环境变量与凭证

### 其他
