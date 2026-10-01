"use client";

import { useEffect, useState } from "react";

import { formatDateline } from "@/lib/date";

type LiveDatelineProps = {
  /** Server-rendered label; keeps the first paint identical on both sides. */
  initial: string;
  /** Server-rendered ISO timestamp, reused for <time dateTime>. */
  initialIso: string;
};

/**
 * Today's date, rendered on the client.
 *
 * The server would freeze the date into the ISR-cached HTML, so a page cached
 * just before midnight would greet the reader with yesterday. Hydrating here
 * keeps the first paint identical to the server markup (both the label and the
 * ISO string come in as props, never from `new Date()` during render), then
 * takes over on the client.
 */
export function LiveDateline({ initial, initialIso }: LiveDatelineProps) {
  const [state, setState] = useState({ label: initial, iso: initialIso });

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setState({ label: formatDateline(now), iso: now.toISOString() });
    };

    update();
    // A tab left open across midnight should roll over without a reload.
    const timer = window.setInterval(update, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <time
      dateTime={state.iso}
      className="shrink-0 font-medium capitalize"
    >
      {state.label}
    </time>
  );
}
