# tegaki-relay: Googleスプレッドシートを管理画面として、Cloudflare Email Routingを運用するためのリレー設定ユーティリティ

tegaki-relayは、使い慣れたGoogleスプレッドシートをUIとして、Cloudflare WorkersとKVを利用した柔軟なメール転送（同報・リレー）を実現するプロジェクトです。インフラはTerraformでコード管理（IaC）されており、低コストかつスケーラブルな運用が可能です。

## コンセプト

- 使いやすいUI: IT管理者や非エンジニアでも、メール転送ルールの追加・削除がGoogleスプレッドシート上で直感的に行えます。
- Infrastructure as Code (IaC): CloudflareのKV、Worker、ルーティングルールといったインフラはTerraformで管理され、再現性と保守性に優れています。
- ハイブリッド運用: 日々変更される転送ルール（非常勤職員、グループアドレスなど）はスプレッドシートで柔軟に管理しつつ、絶対に止められない重要な転送ルール（常勤職員など）はCloudflareの管理画面から高い優先度で設定することで、安全性と柔軟性を両立できます。
- 低コスト: CloudflareとGoogleの無料利用枠の範囲内で概ね運用可能です。

## アーキテクチャ

1. ドメイン宛のメールは、CloudflareのMXレコードによってEmail Routingに送られます。
1. Email Routingのキャッチオールルールが、すべてのメールをtegaki-relayのWorkerに渡します。
1. Workerは、宛先アドレスをキーにしてKV（Key-Valueストア）から転送先リストを問い合わせます。
1. KVに登録があれば、リストにあるすべてのメールアドレスにメールを転送します。登録がなければ、メールを拒否します。
1. KVのデータは、Googleスプレッドシート上のGAS（Google Apps Script）からCloudflare API経由で同期されます。

## セットアップ手順

セットアップは大きく分けて2つのステップで完了します。

### Step 1: Cloudflareインフラの構築 (Terraform)

まず、メールを処理するためのバックエンドをTerraformで構築します。

1. リポジトリをクローン

   ```sh
   git clone <https://github.com/your-username/tegaki-relay.git>
   cd tegaki-relay/terraform
   ```

2. Cloudflareの準備

   - [Cloudflareにログイン](https://dash.cloudflare.com/?to=/:account/home)し、アカウントIDと、対象ドメインのゾーンIDをメモしておきます。
     - アカウントIDはアカウント名横のメニューから`アカウントIDをコピー`で取得できます
     - ゾーンIDはドメイン一覧の右側のメニューから`ゾーンIDをコピー`で取得できます
   - [APIトークン](https://dash.cloudflare.com/profile/api-tokens)を作成します。「Cloudflare API」の「編集」テンプレートを使い、ゾーンリソースを「すべてのゾーン」に設定するのが簡単です。
   - 作成したAPIトークンを環境変数に設定します。

     ```sh
     export CLOUDFLARE_API_TOKEN="your-cloudflare-api-token"
     ```

3. Terraformの実行

   - terraform.tfvars.sampleをterraform.tfvarsにコピーし、cloudflare_account_idとcloudflare_zone_idを自分の値に書き換えます。
   - インフラをデプロイします。

     ```sh
     terraform init
     terraform apply
     ```

   - 実行後、outputsとして表示されるkv_namespace_idの値を**必ずメモしておいてください**。

### Step 2: 管理用スプレッドシートの準備と設定

次に、転送ルールを管理するためのGoogleスプレッドシートを準備します。

1. テンプレートをコピー
   - [こちらのテンプレートスプレッドシート](https://docs.google.com/spreadsheets/d/your-template-id/edit?usp=sharing) を開きます。（TODO: このURLは公開用のテンプレートに置き換えてください）
   - メニューの「ファイル」 > 「コピーを作成」を選択し、ご自身のGoogleドライブに保存します。
2. 設定値を入力
   - コピーしたスプレッドシートのsettingsシートを開きます。
   - 以下の情報を入力します。
     - CF_ACCOUNT_ID: あなたのCloudflareアカウントID
     - CF_NAMESPACE_ID: Terraform実行時にメモした**KV Namespace ID**
3. APIトークンを安全に設定 (重要)
   - スプレッドシートのメニューから「拡張機能」 > 「Apps Script」を開きます。
   - Apps Scriptエディタの左側メニューから「プロジェクトの設定」（歯車アイコン⚙️）をクリックします。
   - 「スクリプト プロパティ」のセクションまでスクロールし、「スクリプト プロパティを編集」をクリックします。
   - 「プロパティを追加」をクリックし、以下のように入力して「保存」します。
     - プロパティ: CF_API_TOKEN
     - 値: あなたのCloudflare APIトークン

これで全てのセットアップは完了です！

## 使い方

1. forwarding_listシートを開きます。
2. A列にグループアドレス（例: <info@your-domain.com>）、B列以降に転送したい個人のメールアドレスを入力します。
3. 入力が終わったら、スプレッドシート上部のカスタムメニュー「Cloudflare Sync」から「Sync Forwarding Lists to KV」を実行します。
   - 初回実行時には、スクリプトがあなたの代わりにCloudflareを操作することを許可するための承認画面が表示されます。許可してください。
4. 「Sync to Cloudflare KV was successful\!」と表示されれば、同期は成功です。

## テスト

### ローカルテスト

workerディレクトリでnpm testを実行することで、Workerのロジックをローカルでテストできます。

### E2Eテスト

本番ドメインのMXレコードを切り替える前に、テスト用のサブドメイン（例: test.your-domain.com）を作成し、そのサブドメインのMXレコードだけをCloudflareに向けることで、本番環境に影響を与えずに安全なE2Eテストが可能です。
