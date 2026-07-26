"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { ViewerDialog } from "@/features/viewer/components/viewer-dialog";
import type {
  CoreyMcpSettings,
  CoreyMcpSettingsMutation,
} from "@/features/viewer/mcp/settings-contracts";

type Props = {
  theme: "light" | "dark";
  variant?: "header" | "mobile";
  onSettingsChange: () => void;
};

async function errorMessage(response: Response) {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return typeof body?.error === "string" ? body.error : `Request failed (${response.status}).`;
}

export function McpSettingsControl({
  theme,
  variant = "header",
  onSettingsChange,
}: Props) {
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<CoreyMcpSettings | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<"load" | "toggle" | "rotate" | null>("load");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [guide, setGuide] = useState<"codex" | "claude">("codex");

  const load = useCallback(async () => {
    setBusy("load");
    setError(null);
    const response = await fetch("/api/mcp/settings", { cache: "no-store" });
    if (response.status === 403 || response.status === 401) {
      setAuthorized(false);
      setBusy(null);
      return;
    }
    setAuthorized(true);
    if (!response.ok) {
      setError(await errorMessage(response));
      setBusy(null);
      return;
    }
    setSettings((await response.json()) as CoreyMcpSettings);
    setBusy(null);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const publishChange = useCallback(() => {
    onSettingsChange();
    const channel = new BroadcastChannel("corey.mcp.settings");
    channel.postMessage("changed");
    channel.close();
  }, [onSettingsChange]);

  async function toggleEnabled() {
    if (!settings) return;
    setBusy("toggle");
    setError(null);
    const response = await fetch("/api/mcp/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !settings.enabled }),
    });
    if (!response.ok) {
      setError(await errorMessage(response));
      setBusy(null);
      return;
    }
    const result = (await response.json()) as CoreyMcpSettingsMutation;
    setSettings(result.settings);
    if (result.apiKey) setApiKey(result.apiKey);
    publishChange();
    setBusy(null);
  }

  async function rotateKey() {
    if (
      settings?.hasApiKey &&
      !window.confirm("Refresh the MCP API key? The previous key will stop working immediately.")
    ) {
      return;
    }
    setBusy("rotate");
    setError(null);
    const response = await fetch("/api/mcp/settings/api-key", { method: "POST" });
    if (!response.ok) {
      setError(await errorMessage(response));
      setBusy(null);
      return;
    }
    const result = (await response.json()) as CoreyMcpSettingsMutation;
    setSettings(result.settings);
    setApiKey(result.apiKey ?? null);
    publishChange();
    setBusy(null);
  }

  async function copy(value: string, id: string) {
    await navigator.clipboard.writeText(value);
    setCopied(id);
    window.setTimeout(() => setCopied((current) => (current === id ? null : current)), 1600);
  }

  const mcpUrl = settings?.mcpUrl ?? "https://your-corey.example/mcp";
  const displayKey = apiKey ?? "<your-corey-api-key>";
  const codexEnv = `export COREY_MCP_API_KEY='${displayKey}'`;
  const codexToml = `[mcp_servers.corey]\nurl = "${mcpUrl}"\nbearer_token_env_var = "COREY_MCP_API_KEY"`;
  const hostedClaudeReady = useMemo(() => {
    try {
      const url = new URL(mcpUrl);
      return url.protocol === "https:" && !["localhost", "127.0.0.1"].includes(url.hostname);
    } catch {
      return false;
    }
  }, [mcpUrl]);

  if (authorized !== true) return null;

  const button = (
    <button
      type="button"
      onClick={() => {
        setOpen(true);
        setApiKey(null);
        void load();
      }}
      className={
        variant === "mobile"
          ? "inline-flex h-10 w-full items-center justify-start gap-2 rounded-[var(--r-control)] border border-[color:var(--viewer-border)] bg-[color:var(--surface-strong)] px-4 text-sm font-semibold text-[color:var(--foreground)] shadow-sm transition hover:bg-[color:var(--surface-hover)]"
          : "inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-[var(--r-control)] border border-[color:var(--viewer-border)] bg-[color:var(--surface-strong)] px-4 text-sm font-semibold text-[color:var(--foreground)] shadow-sm transition hover:border-[color:var(--viewer-border-strong)] hover:bg-[color:var(--surface-hover)]"
      }
    >
      <ShieldCheck className="h-4 w-4" />
      <span>MCP</span>
    </button>
  );

  return (
    <>
      {button}
      {open ? (
        <ViewerDialog
          icon={<ShieldCheck className="h-5 w-5 text-[color:var(--accent)]" />}
          title="MCP access"
          subtitle={settings?.enabled ? "enabled" : "disabled"}
          ariaLabel="MCP settings"
          onClose={() => {
            setOpen(false);
            setApiKey(null);
          }}
          theme={theme}
        >
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {error ? (
              <div className="mb-4 rounded-lg border border-[color:var(--danger-fg)]/40 bg-[color:var(--danger-fg)]/10 p-3 text-sm text-[color:var(--danger-fg)]">
                {error}
              </div>
            ) : null}
            {busy === "load" && !settings ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-[color:var(--muted-ink)]">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading MCP settings…
              </div>
            ) : settings ? (
              <div className="space-y-5">
                <section className="rounded-xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h2 className="text-sm font-semibold">Deployment access</h2>
                      <p className="mt-1 text-xs text-[color:var(--muted-ink)]">
                        Keep the companion running while allowing or denying all MCP clients.
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-label="Enable COREY MCP access"
                      aria-checked={settings.enabled}
                      disabled={!settings.deploymentReady || busy !== null}
                      onClick={() => void toggleEnabled()}
                      className={`relative h-7 w-12 shrink-0 rounded-full transition ${
                        settings.enabled ? "bg-[color:var(--accent)]" : "bg-[color:var(--viewer-border-strong)]"
                      } disabled:cursor-not-allowed disabled:opacity-50`}
                    >
                      <span
                        className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${
                          settings.enabled ? "left-6" : "left-1"
                        }`}
                      />
                    </button>
                  </div>
                  {!settings.deploymentReady ? (
                    <p className="mt-3 text-xs text-[color:var(--danger-fg)]">
                      Configure the MCP public URLs, browser bridge URL, and shared secret before enabling access.
                    </p>
                  ) : null}
                </section>

                <section className="rounded-xl border border-[color:var(--viewer-border)] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="flex items-center gap-2 text-sm font-semibold">
                        <KeyRound className="h-4 w-4" /> API key
                      </h2>
                      <p className="mt-1 text-xs text-[color:var(--muted-ink)]">
                        {settings.hasApiKey
                          ? `Current key ends in ${settings.apiKeyHint}.`
                          : "No API key has been generated."}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void rotateKey()}
                      className="inline-flex h-9 items-center gap-2 rounded-lg border border-[color:var(--viewer-border)] px-3 text-xs font-semibold hover:bg-[color:var(--surface-hover)] disabled:opacity-50"
                    >
                      {busy === "rotate" ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                      {settings.hasApiKey ? "Refresh key" : "Generate key"}
                    </button>
                  </div>
                  {apiKey ? (
                    <CopyBlock
                      label="Copy this key now—it will not be shown again."
                      value={apiKey}
                      copied={copied === "key"}
                      onCopy={() => void copy(apiKey, "key")}
                    />
                  ) : null}
                </section>

                <section className="rounded-xl border border-[color:var(--viewer-border)] p-4">
                  <h2 className="text-sm font-semibold">Connect an MCP client</h2>
                  <CopyBlock
                    label="Streamable HTTP endpoint"
                    value={mcpUrl}
                    copied={copied === "url"}
                    onCopy={() => void copy(mcpUrl, "url")}
                  />
                  <div className="mt-4 flex gap-2 border-b border-[color:var(--viewer-border)]">
                    {(["codex", "claude"] as const).map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setGuide(value)}
                        className={`border-b-2 px-3 py-2 text-xs font-semibold capitalize ${
                          guide === value
                            ? "border-[color:var(--accent)] text-[color:var(--foreground)]"
                            : "border-transparent text-[color:var(--muted-ink)]"
                        }`}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                  {guide === "codex" ? (
                    <div className="space-y-3 pt-4">
                      {!apiKey ? (
                        <p className="text-xs text-[color:var(--muted-ink)]">
                          Refresh the API key to generate a fully copy-ready configuration.
                        </p>
                      ) : null}
                      <CopyBlock
                        label="Shell environment"
                        value={codexEnv}
                        copied={copied === "codex-env"}
                        onCopy={() => void copy(codexEnv, "codex-env")}
                      />
                      <CopyBlock
                        label="~/.codex/config.toml"
                        value={codexToml}
                        copied={copied === "codex-toml"}
                        onCopy={() => void copy(codexToml, "codex-toml")}
                      />
                    </div>
                  ) : (
                    <div className="space-y-3 pt-4 text-xs leading-5 text-[color:var(--muted-ink)]">
                      {!hostedClaudeReady ? (
                        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-amber-700 dark:text-amber-300">
                          Claude web and Desktop connect from Anthropic&apos;s cloud. Publish this endpoint over HTTPS before connecting.
                        </p>
                      ) : null}
                      <ol className="list-decimal space-y-1 pl-5">
                        <li>Open Claude and go to Customize → Connectors.</li>
                        <li>Choose Add custom connector and paste the endpoint above.</li>
                        <li>Connect, then approve the request in the COREY authorization page.</li>
                      </ol>
                      <a
                        href="https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-semibold text-[color:var(--accent)]"
                      >
                        Claude connector documentation <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  )}
                </section>
              </div>
            ) : null}
          </div>
        </ViewerDialog>
      ) : null}
    </>
  );
}

function CopyBlock({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-[color:var(--muted-ink)]">{label}</span>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-[color:var(--accent)]"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-slate-950 p-3 text-xs leading-5 text-slate-100">
        <code>{value}</code>
      </pre>
    </div>
  );
}
