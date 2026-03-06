# WorkItem 正規化モデル（GitHub Projects）

## 目的
GitHub Project item と紐づく Issue/PR を、実行系が扱いやすい `WorkItem` に正規化する。

## 正規化後の型
- `id`: 内部一意ID（GitHub node id）
- `identifier`: 人間可読ID（`owner/repo#number`）
- `title`: タイトル
- `description`: 本文（未設定時は空文字）
- `priority`: 優先度（任意）
- `state`: `todo | in_progress | blocked | done`
- `labels`: ラベル名配列
- `url`: Issue/PR URL
- `blocked_by`: 依存元 ID 配列（文字列）

## マッピングルール
1. `identifier` は `repositorySlug + # + number`
2. `state` は以下で正規化
   - 入力は `trim + lowercase`
   - エイリアス変換
     - `todo/backlog/to do/open` → `todo`
     - `in progress/in_progress/doing` → `in_progress`
     - `blocked` → `blocked`
     - `done/closed` → `done`
   - 不明値は `todo`
3. `state` 優先順位
   - project status があればそれを採用
   - なければ linked issue/pr state を採用
4. `blocked_by` は number/string 混在を文字列に統一

## workspace key サニタイズ戦略
`sanitizeWorkspaceKey` で以下を適用:
- 前後空白を除去
- 小文字化
- 英数字以外を `-` へ置換
- 連続記号や先頭末尾の `-` を除去

例:
- `"  Team A / Sprint 1  "` → `"team-a-sprint-1"`
- `"Feature:Auth#Core"` → `"feature-auth-core"`
