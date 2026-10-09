# Changelog

本文件记录项目的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/spec/v2.0.0.html)。

## [Unreleased]

### Added

- 新增 `pi-delete-approval` 扩展：agent 通过 shell 执行文件删除命令（`rm`、`find -delete`、`Remove-Item`、内联脚本删除 API 等）前弹窗审批，支持“允许一次 / 本会话允许同一命令 / 拒绝”，无 UI 时直接阻止，并将决策写入 `pi-delete-approval.jsonl` 审计日志。
