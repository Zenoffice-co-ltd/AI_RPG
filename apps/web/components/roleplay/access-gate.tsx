export function AccessGate({
  denied,
  accessAction,
}: {
  denied: boolean;
  accessAction: string;
}) {
  return (
    <main className="roleplay-access">
      <form action={accessAction} method="post" className="roleplay-access__panel">
        <h1>MENDAN AIロープレ</h1>
        <p>デモを開始するにはアクセスコードを入力してください。</p>
        <input
          className="roleplay-access__input"
          name="token"
          type="password"
          autoComplete="current-password"
          aria-label="アクセスコード"
          placeholder="アクセスコード"
        />
        {denied ? <span role="alert">アクセスコードを確認してください。</span> : null}
        <button type="submit">開始</button>
      </form>
    </main>
  );
}

export function ServiceUnavailable() {
  return (
    <main className="roleplay-access">
      <section className="roleplay-access__panel">
        <h1>MENDAN AIロープレ</h1>
        <p>ただいまデモを利用できません。時間をおいて再試行してください。</p>
      </section>
    </main>
  );
}

export function stringParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
