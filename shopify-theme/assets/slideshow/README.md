# Hero スライドショー用画像フォルダ

トップページ Hero のスライドショーは、**このフォルダの画像だけ**で構成されます（動画は使いません）。

- 保存場所: `C:\Users\reito\OneDrive\Desktop\gira-shopify-theme\shopify-theme\assets\slideshow\`
- 対応形式: JPG / JPEG / PNG / WebP（大文字拡張子も可）
- 推奨サイズ: 横 2000〜2400px、1枚 500KB 以下（20MB 超は無視されます）。縦横比は全スライドで揃えてください（PC は横長 16:9〜21:9、スマホでも同じ画像を中央寄せで表示）。
- 最大 20 枚。画像 1 枚のときは矢印とドットを非表示、0 枚のときは従来の Hero 画像を表示します。
- 切り替え 5 秒・フェード 0.8 秒（テーマエディターの Hero セクションで変更可）。

## 表示順
ファイル名の昇順（数字は数値順）です。順番を変えたいときはファイル名の先頭番号を変更します。

```
01-main.jpg
02-campaign.jpg
03-new-collection.webp
```

同一内容の画像（重複）は自動的に 1 枚にまとめられます。

## 自動同期の仕組み
Liquid はローカルフォルダを読めないため、同期スクリプト `scripts/hero-sync.mjs` が次を行います。

1. このフォルダの画像を検出（ファイル名順・内容ハッシュで重複/差し替えを判定）
2. 画像をテーマ Assets（`hero-slide-NN-<hash>.<ext>`）としてアップロード
3. 表示リスト `snippets/gira-hero-slides.liquid` を自動更新
4. フォルダから消えた画像を Shopify 側からも削除
5. 失敗時は 3 回まで再試行し、ログを `logs/hero-sync.log` に保存

Liquid / JSON を手で編集する必要はありません。`.shopifyignore` によりこのフォルダ自体はテーマに送信されません（唯一の管理フォルダです）。

### 方法A: このPCで実行（認証済みの Shopify CLI を使用）
```
npm run hero:sync     # 1回だけ同期
npm run hero:watch    # フォルダを監視し、変更の数秒後に自動同期（ウィンドウを開いたままにする）
```
PC をスリープ/終了すると監視は止まります。次回 `npm run hero:sync` か `hero:watch` を実行すると反映されます。

### 方法B: GitHub Actions（PCを閉じていても動作・無料枠）
画像を追加して `main` に push すると `.github/workflows/hero-sync.yml` が自動同期します。初回のみ設定が必要です。

1. Shopify 管理画面 → アプリ → 「Theme Access」アプリで、パスワードを発行
2. GitHub リポジトリ → Settings → Secrets and variables → Actions
   - Secret: `SHOPIFY_CLI_THEME_TOKEN` = 発行したパスワード
   - Variable（任意）: `SHOPIFY_STORE`（既定 `giragiraglasses.myshopify.com`）、`HERO_THEME_ID`（既定は現在の公開テーマ `167141834835`）
3. 公開テーマを切り替えた場合は `HERO_THEME_ID`（と必要なら `npm` 実行時の環境変数）を更新

※ 方法B はトークン設定後に初めて動作します（未設定の間は失敗します）。

## 同期エラーの対処
- `logs/hero-sync.log`（Actions の場合は実行ログ）を確認
- `shopify` コマンドが無い → `npm install -g @shopify/cli`
- 認証エラー → ローカルは `shopify auth logout` 後に再実行して再ログイン、Actions は Secret の再発行
- 画像が出ない → 形式・サイズを確認し、ブラウザを強制再読み込み（反映に数十秒かかることがあります）
- 手動復旧: `npm run hero:sync` を再実行（何度実行しても安全）

