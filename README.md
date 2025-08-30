# tegaki-relay: Googleスプレッドシートを管理画面として、Cloudflare Email Routingを運用するための管理ツール

tegaki-relayは、使い慣れたGoogleスプレッドシートをUIとして、Cloudflare WorkersとKVを利用した柔軟なメール転送（同報・リレー）を実現するプロジェクトです。インフラはTerraformでコード管理（IaC）されており、低コストかつスケーラブルな運用が可能です。

## コンセプト

- 使いやすいUI: IT管理者や非エンジニアでも、メール転送ルールの追加・削除がGoogleスプレッドシート上で直感的に行えます。
- Infrastructure as Code (IaC): CloudflareのKV、Worker、ルーティングルールといったインフラはTerraformで管理され、再現性と保守性に優れています。
- ハイブリッド運用: 日々変更される転送ルール（非常勤職員、グループアドレスなど）はスプレッドシートで柔軟に管理しつつ、絶対に止められない重要な転送ルール（常勤職員など）はCloudflareの管理画面から高い優先度で設定することで、安全性と柔軟性を両立できます。
- 低コスト: CloudflareとGoogleの無料利用枠の範囲内で十分に運用可能です。

## アーキテクチャ

1. ドメイン宛のメールは、CloudflareのMXレコードによってEmail Routingに送られます。
2. Email Routingのキャッチオールルールが、すべてのメールをtegaki-relayのWorkerに渡します。
3. Workerは、宛先アドレスをキーにしてKV（Key-Valueストア）から転送先リストを問い合わせます。
4. KVに登録があれば、リストにあるすべてのメールアドレスにメールを転送します。登録がなければ、メールを拒否します。
5. KVのデータは、Googleスプレッドシート上のGAS（Google Apps Script）からCloudflare API経由で同期されます。

## セットアップ手順

セットアップは大きく分けて2つのステップで完了します。

### Step 1: Cloudflareインフラの構築 (Terraform)

まず、メールを処理するためのバックエンドをTerraformで構築します。

1. リポジトリをクローン:  
   git clone [https://github.com/your-username/tegaki-relay.git](https://github.com/your-username/tegaki-relay.git)  
   cd tegaki-relay/terraform

2. Cloudflareの準備:
   - Cloudflareにログインし、[アカウントID](https://dash.cloudflare.com/?to=/:account/workers-and-pages)と、対象ドメインの`ゾーンID`をメモしておきます。
   - [APIトークン](https://dash.cloudflare.com/profile/api-tokens)を作成します。トークンはterraform実行用と管理スプレッドシートへの設定用の二つを作成してください。それぞれ、下記の権限を付与します。
     - terraform実行用
       - アカウント - Email Routing アドレス: 編集
       - アカウント - Workers KV Storage: 編集
       - アカウント - Workers スクリプト: 編集
       - アカウント - アカウント設定: 読み取り
       - ゾーン - Email Routing ルール: 編集
       - ゾーン - ゾーン設定: 編集
       - ゾーン - ゾーン: 読み取り
     - 管理スプレッドシート用
       - アカウント - Email Routing アドレス: 編集
       - アカウント - Workers KV Storage: 編集
       - アカウント - アカウント設定: 読み取り
   - 作成したAPIトークンを環境変数に設定します。  
     export CLOUDFLARE_API_TOKEN="your-cloudflare-api-token"

3. Terraformの実行:
   - terraform.tfvars.sampleをterraform.tfvarsにコピーし、cloudflare_account_idとcloudflare_zone_idを自分の値に書き換えます。
   - インフラをデプロイします。  
     terraform init  
     terraform apply

   - 実行後、outputsとして表示されるkv_namespace_idの値を**必ずメモしておいてください**。

### Step 2: 管理用スプレッドシートのセットアップ

次に、GAS（Google Apps Script）を使って、転送ルールを管理するスプレッドシートを準備します。

1. スプレッドシートを新規作成:
   - ブラウザで sheets.new と入力し、まっさらなスプレッドシートを作成します。
2. GASコードを貼り付け:
   - メニューの「拡張機能」 > 「Apps Script」を開きます。
   - エディタが開いたら、コード.gs (または Code.gs) の中身を**すべて削除**します。
   - このリポジトリの gas/src/Code.js の内容をすべてコピーし、エディタに貼り付けます。
   - **重要**: エディタの左メニュー「プロジェクトの設定」⚙️ をクリックし、「**「appsscript.json」マニフェスト ファイルをエディタで表示する**」にチェックを入れます。
   - 左のファイル一覧に appsscript.json が現れたらクリックし、gas/src/appsscript.json の内容をコピーして貼り付け（上書き）ます。
   - フロッピーディスクのアイコン💾をクリックして、プロジェクトを保存します。
3. シートを初期化:
   - スプレッドシートのタブに戻り、**ページを再読み込み（リロード）** します。
   - メニューに「**Tegaki Relay**」というカスタムメニューが追加されています。
   - 「Tegaki Relay」 > 「**Initialize Sheet**」を実行します。
   - settings と forwarding_list という名前のシートが自動的に作成されれば成功です。
4. 設定値を入力:
   - 自動生成された settings シートを開き、以下の情報を入力します。入力値は、terraformのアウトプットで確認できます。
     - CF_ACCOUNT_ID: あなたのCloudflareアカウントID
     - CF_NAMESPACE_ID: Terraform実行時にメモした **KV Namespace ID**
5. APIトークンを安全に設定:
   - Apps Scriptエディタに戻り、「プロジェクトの設定」⚙️ をクリックします。
   - 「スクリプト プロパティ」セクションで「スクリプト プロパティを編集」をクリックし、以下のプロパティを追加して保存します。
     - プロパティ: CF_API_TOKEN
     - 値: 管理スプレッドシート用のAPIトークン

これで全てのセットアップは完了です！

## 使い方

1. forwarding_listシートを開きます。
2. A列にグループアドレス（例: info@your-domain.com）、B列以降に転送したい個人のメールアドレスを入力します。
3. 入力が終わったら、スプレッドシート上部のカスタムメニュー「Tegaki Relay」から「Cloudflareへ同期」を実行します。
   - 初回実行時には、スクリプトがあなたの代わりにCloudflareを操作することを許可するための承認画面が表示されます。許可してください。
4. 「Cloudflareへの同期が成功しました。」と表示されれば、同期は成功です。

> [!IMPORTANT]
> Cloudflareの宛先アドレスに登録がないメールアドレスへの配信は失敗するため、本ツールでは未登録アドレス、未確認アドレスがあった場合はKVへの同期を中止します。
> 未登録アドレスの場合は、確認画面で自動登録可否を確認した上でCloudflareへの自動登録と確認メール送信を行います。確認メールでの確認が終わった後に再試行することで登録を続行できます。

> [!NOTE]
> 1000件以上の宛先アドレスがある場合は正常に動作しません。本ツールの制限です。

## テスト

### ローカルテスト

workerディレクトリでnpm testを実行することで、Workerのロジックをローカルでテストできます。

### GAS（Google Apps Script）側のテスト・デバッグ

- スプレッドシート上で「Tegaki Relay」メニューから各操作を実行し、動作やエラー表示を確認してください。
- エラーやログは、Apps Scriptエディタの「表示」→「ログ」や「実行」タブで確認できます。
- Apps Scriptエディタで関数を選択し「デバッグ」ボタンを押すと、ステップ実行や変数の中身を確認できます。

## ライセンス

MITライセンスに基づいています。詳細は[ライセンスファイル](LICENSE)をご覧ください。

---
