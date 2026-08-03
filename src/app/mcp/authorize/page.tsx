import { headers } from "next/headers";
import { ShieldCheck } from "lucide-react";
import { getMcpAdminUserIds, getUserHeaderName } from "@/server/env";
import { getUserIdFromHeaderValue } from "@/server/identity";
import { getMcpOauthConsent } from "@/server/mcp-settings-store";

export default async function McpAuthorizePage({
  searchParams,
}: {
  searchParams: Promise<{ request?: string }>;
}) {
  const requestHeaders = await headers();
  const userId = getUserIdFromHeaderValue(requestHeaders.get(getUserHeaderName()));
  if (!userId || !getMcpAdminUserIds().includes(userId)) {
    return <ConsentMessage title="Administrator access required" body="This MCP connection must be approved by a configured COREY administrator." />;
  }
  const { request: requestId = "" } = await searchParams;
  const consent = await getMcpOauthConsent(requestId);
  if (!consent) {
    return <ConsentMessage title="Request unavailable" body="This MCP authorization request is invalid, expired, or already used." />;
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-slate-100">
      <section className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
        <div className="mb-5 flex items-center gap-3">
          <ShieldCheck className="h-8 w-8 text-cyan-400" />
          <div>
            <h1 className="text-xl font-semibold">Connect {consent.clientName}</h1>
            <p className="text-sm text-slate-400">Authorize access to COREY MCP</p>
          </div>
        </div>
        <p className="mb-4 text-sm leading-6 text-slate-300">
          This client will be able to inspect stored IFC models and connected viewer tabs,
          navigate views, and apply reversible draft edits as the deployment&apos;s default user.
        </p>
        <div className="mb-6 rounded-xl border border-slate-700 bg-slate-950 p-3 text-xs text-slate-400">
          Redirect: <span className="break-all text-slate-300">{consent.redirectUri}</span>
        </div>
        <form action="/api/mcp/oauth/consent" method="post" className="flex gap-3">
          <input type="hidden" name="requestId" value={consent.requestId} />
          <button
            type="submit"
            name="decision"
            value="approve"
            className="flex-1 rounded-lg bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-300"
          >
            Authorize
          </button>
          <button
            type="submit"
            name="decision"
            value="deny"
            className="flex-1 rounded-lg border border-slate-600 px-4 py-2.5 text-sm font-semibold hover:bg-slate-800"
          >
            Deny
          </button>
        </form>
      </section>
    </main>
  );
}

function ConsentMessage({ title, body }: { title: string; body: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-slate-100">
      <section className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6">
        <h1 className="mb-2 text-xl font-semibold">{title}</h1>
        <p className="text-sm text-slate-400">{body}</p>
      </section>
    </main>
  );
}
