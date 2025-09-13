# tegaki-relay: Googleスプレッドシートを管理画面として、Cloudflare Email Routingを運用するための管理ツール

tegaki-relayは、使い慣れたGoogleスプレッドシートをUIとして、Cloudflare WorkersとKVを利用した柔軟なメール転送（同報・リレー）を実現するプロジェクトです。インフラはTerraformでコード管理（IaC）されており、低コストかつスケーラブルな運用が可能です。

## コンセプト

- 使いやすいUI: IT管理者や非エンジニアでも、メール転送ルールの追加・削除がGoogleスプレッドシート上で直感的に行えます。
- Infrastructure as Code (IaC): CloudflareのKV、Worker、ルーティングルールといったインフラはTerraformで管理され、再現性と保守性に優れています。
- ハイブリッド運用: スプレッドシートで管理するルールに加え、Cloudflareの管理画面で直接設定されたメールルーティングルールも尊重します。スプレッドシート上のグループはCloudflare上のルールを転送先として参照でき、柔軟な構成が可能です。また、両者で設定が競合した場合は、意図しない上書きを防ぐために処理を安全に停止します。
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
       - ゾーン - Email Routing ルール: 読み取り
   - 作成したAPIトークンを環境変数に設定します。  
     export CLOUDFLARE_API_TOKEN="your-cloudflare-api-token"

3. Terraformの実行:
   - terraform.tfvars.sampleをterraform.tfvarsにコピーし、cloudflare_account_idとcloudflare_zone_idを自分の値に書き換えます。
   - インフラをデプロイします。  
     terraform init  
     terraform apply

   - 実行後、outputsとして表示されるkv_namespace_idの値を**必ずメモしておいてください**。

### Step 2: 管理用スプレッドシートのセットアップ

次に、GAS（Google Apps Script）のコードをデプロイし、転送ルールを管理するスプレッドシートを準備します。ここでは、GASプロジェクトをコマンドラインから管理できる`clasp`を利用します。

1. `clasp`のインストールとログイン:
   - `clasp`をインストールします。  
     `npm install -g @google/clasp`
   - Googleアカウントにログインします。  
     `clasp login`
   - **Apps Script APIを有効にする**:
     - Google Apps Script設定ページにアクセスし、「Google Apps Script API」をオンにします。APIが有効でないと`clasp`は動作しません。

2. スプレッドシートの作成と紐付け:
   - ブラウザで `sheets.new` と入力し、まっさらなスプレッドシートを作成します。
   - メニューの「拡張機能」 > 「Apps Script」を開きます。
   - エディタの左メニュー「プロジェクトの設定」⚙️ をクリックし、「**スクリプト ID**」をコピーします。
   - リポジトリの`gas`ディレクトリにある`clasp.json.sample`を`.clasp.json`にコピーし、`YOUR_SCRIPT_ID`の部分をコピーしたスクリプトIDに置き換えます。

3. GASコードのデプロイ:
   - `gas`ディレクトリに移動し、`clasp push`を実行します。`src`ディレクトリ内のすべてのコードがApps Scriptプロジェクトにアップロードされます。

     ```bash
     cd gas
     clasp push
     ```

4. シートの初期化:
   - スプレッドシートのタブに戻り、**ページを再読み込み（リロード）** します。
   - メニューに「**Tegaki Relay**」というカスタムメニューが追加されています。
   - 「Tegaki Relay」 > 「**Initialize Sheet**」を実行します。
   - `settings` と `forwarding_list` という名前のシートが自動的に作成されれば成功です。

5. 設定値を入力:
   - 自動生成された `settings` シートを開き、以下の情報を入力します。
     - `CF_ACCOUNT_ID`: あなたのCloudflareアカウントID
     - `CF_NAMESPACE_ID`: Terraform実行時にメモした **KV Namespace ID**
     - `CF_ZONE_ID`: あなたのドメインのゾーンID
     - `DOMAIN_NAME`: あなたのドメイン名（例: `example.com`）

6. APIトークンを安全に設定:
   - Apps Scriptエディタに戻り、左メニューの「プロジェクトの設定」⚙️ をクリックします。
   - 「スクリプト プロパティ」セクションまでスクロールし、「スクリプト プロパティを編集」をクリックします。
   - 以下のプロパティを追加して「スクリプト プロパティを保存」をクリックします。
     - **プロパティ**: `CLOUDFLARE_API_TOKEN`
     - **値**: Step 1で作成した「管理スプレッドシート用」のAPIトークン

## 使い方

1. `forwarding_list`シートを開きます。
2. A列にグループアドレス（例: `info` や `info@your-domain.com`）、B列以降に転送したい個人のメールアドレスや、他のグループアドレスを入力します。
   - A列の値が`#`で始まる場合はコメント行とみなして転送対象としません。
3. 入力が終わったら、スプレッドシート上部のカスタムメニュー「Tegaki Relay」から操作を選択します。
   - **Dry Runを実行**: 実際にCloudflareへ変更を適用する前に、どのような変更が行われるかを確認できます。`dry-run-result`というシートが作成され、KVに追加/更新されるデータ、削除されるデータ、認証が必要なアドレスの一覧が表示されます。本番反映前の確認に便利です。
   - **Cloudflareへ同期**: 実際にCloudflare KVへデータを同期します。
     - 実行前に確認ダイアログが表示されます。処理が完了すると、変更内容を記録したログシート（`sync-log-YYYY-MM-DD-HHMMSS`）が作成されます。
4. 「Cloudflareへの同期が成功しました。」または「Dry Runが完了しました。」と表示されれば、処理は成功です。

> [!IMPORTANT]
> Cloudflareの宛先アドレスに登録がないメールアドレスへの配信は失敗するため、本ツールでは未登録アドレス、未確認アドレスがあった場合はKVへの同期を中止します。
> 未登録アドレスの場合は、確認画面で自動登録可否を確認した上でCloudflareへの自動登録と確認メール送信を行います。確認メールでの確認が終わった後に再試行することで登録を続行できます。

> [!IMPORTANT]
> **設定の競合について**
> スプレッドシート上の転送ルールと、Cloudflareの管理画面で設定されたメールルーティングルールの内容が異なる（宛先が同じで転送先が違う）場合、意図しない上書きを防ぐために同期処理は安全に停止します。Dry Runまたは本番実行時に競合が検知されると、内容を比較できるレポートシートが作成されます。

> [!NOTE]
> KVからキーをリストする際のAPIの制限により、1000件以上の転送グループがある場合は正常に動作しません。本ツールの制限です。

## テスト

### Worker側のローカルテスト

`worker`ディレクトリで`npm test`を実行することで、Workerのロジックをローカルでテストできます。

### GAS側のローカルテスト

GASのコアロジック（データ整形、APIクライアントなど）も、`vitest`を使ってローカルで高速にテストできます。

1. `gas`ディレクトリに移動します。

   ```bash
   cd gas
   ```

2. 依存関係をインストールします。

   ```bash
   npm install
   ```

3. テストを実行します。

   ```bash
   npm test
   ```

   より詳細なレポートを見たい場合は、`npm run test:verbose` を実行してください。

### スプレッドシート上でのテスト・デバッグ

- スプレッドシート上で「Tegaki Relay」メニューから各操作を実行し、実際の動作やエラー表示を確認してください。
- エラーやログは、Apps Scriptエディタの「表示」→「ログ」や「実行」タブで確認できます。
- Apps Scriptエディタで関数を選択し「デバッグ」ボタンを押すと、ステップ実行や変数の中身を確認できます。

## ライセンス

MITライセンスに基づいています。詳細は[ライセンスファイル](LICENSE)をご覧ください。

---
