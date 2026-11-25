# Access and download metrics / アクセス・DL集計

GitHub Insights → Traffic shows repository visits and full clones over the last 14 days. Release assets expose cumulative download counts, separately for index.html and sim.js. These are not unique people or successful plays.

日本語：リポジトリ閲覧・cloneはInsights → Trafficで確認できます。Releaseの添付ファイルにはファイル別累計DL数があります。GitHub自動生成ソースZIP、全raw取得、Pagesのゲーム利用人数を網羅する集計ではありません。自分や自動処理のアクセスも含み得ます。

## Automation (disabled until owner approval)

Actions → Traffic snapshot is gated by repository variable `TRAFFIC_ENABLED=true`. Scheduled time is 03:17 UTC (12:17 JST); GitHub may delay scheduled jobs. Aggregate snapshots would be public on the traffic branch. No tracking script is added to the game or README.

For traffic-history automation, the owner must create a fine-grained token limited to **atenisoc/werewolf-strategy-engine**, with **Administration: read-only** (Metadata read is implicit), then save it as Actions secret **TRAFFIC_TOKEN**. Never paste it into chat, issues, README, or source. Set an expiry and renew when needed. The workflow's GITHUB_TOKEN handles snapshot commits, so the traffic-reading token does not need Contents write.

14日合計を日々足すと重複します。長期PV/cloneは日別データの同じ日を重複除外して集計してください。日別UUの合算は期間全体の実人数ではありません。配布ファイルの差し替えでDL累計がリセットされる場合があるため、同じasset IDの差分だけを比べます。GitHub Pagesの閲覧はリポジトリの閲覧とは別です。

References: [GitHub traffic](https://docs.github.com/en/repositories/viewing-activity-and-data-for-your-repository/viewing-traffic-to-a-repository), [Traffic API](https://docs.github.com/en/rest/metrics/traffic).
