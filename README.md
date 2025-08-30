# tegaki-relay: Googleスプレッドシートを管理画面として、Cloudflare Email Routingを運用するためのリレーサーバー

tegaki-relayは、使い慣れたGoogleスプレッドシートをUIとして、Cloudflare WorkersとKVを利用した柔軟なメール転送（同報・リレー）を実現するプロジェクトです。インフラはTerraformでコード管理（IaC）されており、低コストかつスケーラブルな運用が可能です。

## コンセプト

* 使いやすいUI: IT管理者や非エンジニアでも、メール転送ルールの追加・削除がGoogleスプレッドシート上で直感的に行えます。  
* Infrastructure as Code (IaC): CloudflareのKV、Worker、ルーティングルールといったインフラはTerraformで管理され、再現性と保守性に優れています。  
* ハイブリッド運用: 日々変更される転送ルール（非常勤職員、グループアドレスなど）はスプレッドシートで柔軟に管理しつつ、絶対に止められない重要な転送ルール（常勤職員など）はCloudflareの管理画面から高い優先度で設定することで、安全性と柔軟性を両立できます。  
* 低コスト: CloudflareとGoogleの無料利用枠の範囲内で十分に運用可能です。

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
   * Cloudflareにログインし、[アカウントID](https://dash.cloudflare.com/?to=/:account/workers-and-pages)と、対象ドメインの`ゾーンID`をメモしておきます。  
   * [APIトークン](https://dash.cloudflare.com/profile/api-tokens)を作成します。「Cloudflare API」の「編集」テンプレートを使い、ゾーンリソースを「すべてのゾーン」に設定するのが簡単です。  
   * 作成したAPIトークンを環境変数に設定します。  
     export CLOUDFLARE_API_TOKEN="your-cloudflare-api-token"

3. Terraformの実行:  
   * terraform.tfvars.sampleをterraform.tfvarsにコピーし、cloudflare_account_idとcloudflare_zone_idを自分の値に書き換えます。  
   * インフラをデプロイします。  
     terraform init  
     terraform apply

   * 実行後、outputsとして表示されるkv_namespace_idの値を**必ずメモしておいてください**。

### Step 2: 管理用スプレッドシートのセットアップ

次に、GAS（Google Apps Script）を使って、転送ルールを管理するスプレッドシートを準備します。

1. スプレッドシートを新規作成:  
   * ブラウザで sheets.new と入力し、まっさらなスプレッドシートを作成します。  
2. GASコードを貼り付け:  
   * メニューの「拡張機能」 > 「Apps Script」を開きます。  
   * エディタが開いたら、コード.gs (または Code.gs) の中身を**すべて削除**します。  
   * このリポジトリの gas/src/Code.js の内容をすべてコピーし、エディタに貼り付けます。  
   * **重要**: エディタの左メニュー「プロジェクトの設定」⚙️ をクリックし、「**「appsscript.json」マニフェスト ファイルをエディタで表示する**」にチェックを入れます。  
   * 左のファイル一覧に appsscript.json が現れたらクリックし、gas/src/appsscript.json の内容をコピーして貼り付け（上書き）ます。  
   * フロッピーディスクのアイコン💾をクリックして、プロジェクトを保存します。  
3. シートを初期化:  
   * スプレッドシートのタブに戻り、**ページを再読み込み（リロード）** します。  
   * メニューに「**Tegaki Relay**」というカスタムメニューが追加されています。  
   * 「Tegaki Relay」 > 「**Initialize Sheet**」を実行します。  
   * settings と forwarding_list という名前のシートが自動的に作成されれば成功です。  
4. 設定値を入力:  
   * 自動生成された settings シートを開き、以下の情報を入力します。  
     * CF_ACCOUNT_ID: あなたのCloudflareアカウントID  
     * CF_NAMESPACE_ID: Terraform実行時にメモした **KV Namespace ID**  
5. APIトークンを安全に設定:  
   * Apps Scriptエディタに戻り、「プロジェクトの設定」⚙️ をクリックします。  
   * 「スクリプト プロパティ」セクションで「スクリプト プロパティを編集」をクリックし、以下のプロパティを追加して保存します。  
     * プロパティ: CF_API_TOKEN  
     * 値: あなたのCloudflare APIトークン

これで全てのセットアップは完了です！

## 使い方

1. forwarding_listシートを開きます。  
2. A列にグループアドレス（例: info@your-domain.com）、B列以降に転送したい個人のメールアドレスを入力します。  
3. 入力が終わったら、スプレッドシート上部のカスタムメニュー「Tegaki Relay」から「Sync to Cloudflare KV」を実行します。  
   * 初回実行時には、スクリプトがあなたの代わりにCloudflareを操作することを許可するための承認画面が表示されます。許可してください。  
4. 「Sync to Cloudflare KV was successful!」と表示されれば、同期は成功です。

## テスト

### ローカルテスト

workerディレクトリでnpm testを実行することで、Workerのロジックをローカルでテストできます。
