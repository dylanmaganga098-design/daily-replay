import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";

import { verifySetup, type VerifyResult } from "@/lib/verifier.functions";

interface VerifierPanelProps {
  /** Analyzer LIVE report: SUMMARY block, live PASS setups, overlaps. */
  scoutData: string;
  /** Raw 30M OHLC CSV with metadata header. */
  ohlcCsv: string;
  /** Called once the verdict is in, so the bundle can be zipped and downloaded. */
  onVerdict?: (result: VerifyResult) => void;
}

export function VerifierPanel({ scoutData, ohlcCsv, onVerdict }: VerifierPanelProps) {
  const runVerifier = useServerFn(verifySetup);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);
  const onVerdictRef = useRef(onVerdict);
  onVerdictRef.current = onVerdict;

  useEffect(() => {
    if (started.current || scoutData.trim() === "") return;
    started.current = true;
    let cancelled = false;

    (async () => {
      setBusy(true);
      setError(null);
      setResult(null);
      try {
        const outcome = await runVerifier({ data: { scoutData, ohlcCsv } });
        if (cancelled) return;
        setResult(outcome);
        onVerdictRef.current?.(outcome);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [scoutData, ohlcCsv, runVerifier]);

  return (
    <section className="panel flex flex-col gap-4 p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-medium text-foreground">Verifier / Picker</h2>
        <p className="text-xs text-muted-foreground">
          Runs automatically on the live PASS setups plus the analysed OHLC, and picks the one trade
          worth taking.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="num text-xs text-muted-foreground">
          {busy
            ? "Verifying…"
            : result
              ? `via ${result.provider} · ${result.model}`
              : error
                ? "Verifier failed"
                : "Waiting for analysis"}
        </span>
      </div>

      {error ? (
        <p className="num rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}

      {result?.warnings.length ? (
        <p className="num rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-xs text-foreground">
          {result.warnings.join(" | ")}
        </p>
      ) : null}

      {result ? (
        <pre className="num max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-secondary/40 p-4 text-xs text-foreground">
          {result.verdict}
        </pre>
      ) : null}
    </section>
  );
}
