"use client";
import type { ActivityRange } from "@orbit/core/activity";
import { number } from "@/lib/utils";
import { useState } from "react";
import { Card, Select } from "./ui/primitives";
import { useWorkspace } from "./workspace";

function curve(points: [number, number][]) {
  return points
    .map(([x, y], index) => {
      if (!index) return `M${x},${y}`;
      const prev = points[index - 1],
        before = points[index - 2] ?? prev,
        next = points[index + 1] ?? [x, y];
      return `C${prev[0] + (x - before[0]) / 6},${prev[1] + (y - before[1]) / 6} ${x - (next[0] - prev[0]) / 6},${y - (next[1] - prev[1]) / 6} ${x},${y}`;
    })
    .join(" ");
}
export function ActivityChart({ range }: { range: string }) {
  const { data } = useWorkspace();
  const [metric, setMetric] = useState<"events" | "members">("events");
  const [hover, setHover] = useState<number | null>(null);
  const days: ActivityRange =
    range === "Last 30 days" ? 30 : range === "Last 14 days" ? 14 : 7;
  const snapshot = data.presentation.activity;
  const window = snapshot.ranges[days];
  const buckets = window.buckets;
  const values = buckets.map((bucket) => bucket[metric]);
  const previousValues = buckets.map((bucket) => bucket.previous[metric]);
  const max = Math.max(
    4,
    Math.ceil(Math.max(...values, ...previousValues) / 4) * 4
  );
  const pointsFor = (values: number[]) =>
    values.map((value, index): [number, number] => [
      48 + (index * 528) / (days - 1),
      180 - (value / max) * 150,
    ]);
  const points = pointsFor(values),
    line = curve(points),
    previous = curve(pointsFor(previousValues));
  const metricName = metric === "events" ? "Reward events" : "Rewarded members";
  return (
    <Card
      className="overflow-hidden"
      data-activity-reference={snapshot.referenceAt}
      data-activity-timezone={snapshot.timeZone}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-2 pt-4">
        <div>
          <h2 className="text-[12px] font-semibold">Community activity</h2>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Daily activity rewards · {snapshot.timeZone} · {window.start} –{" "}
            {window.end}
          </p>
        </div>
        <Select
          aria-label="Chart metric"
          value={metric}
          onChange={(event) => {
            setMetric(event.target.value as typeof metric);
            setHover(null);
          }}
          className="h-8 w-40 rounded-md px-2 text-[10px]"
        >
          <option value="events">Reward events</option>
          <option value="members">Rewarded members</option>
        </Select>
      </div>
      <div className="mx-5 mt-2 flex flex-wrap gap-4 text-[9px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-[#a58ad7]" />
          This period
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-[#d4c5ea]" />
          Previous {days} days
        </span>
        {snapshot.demo && (
          <span className="ml-auto uppercase tracking-wider">
            Sample activity
          </span>
        )}
      </div>
      <p className="mx-5 mt-2 text-[9px] text-muted-foreground">
        {snapshot.demo
          ? "Illustrative samples, not production measurements. "
          : "Activity-reward ledger only, not all messages, commands or total server members. "}
        Today is partial.
      </p>
      <div className="relative px-1 pb-0.5">
        <svg
          viewBox="0 0 640 214"
          className="block w-full"
          role="img"
          aria-label={`${metricName} activity chart`}
          onMouseLeave={() => setHover(null)}
          data-activity-labels={buckets.map((bucket) => bucket.label).join("|")}
          data-activity-values={buckets
            .map(
              (bucket) =>
                `${bucket.key}:${bucket.events},${bucket.members}:${bucket.previous.events},${bucket.previous.members}`
            )
            .join("|")}
        >
          <defs>
            <linearGradient id="activityFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#b197e4" stopOpacity=".19" />
              <stop offset="1" stopColor="#b197e4" stopOpacity=".015" />
            </linearGradient>
          </defs>
          {[0, 1, 2, 3, 4].map((index) => (
            <g key={index}>
              <line
                x1="48"
                x2="598"
                y1={180 - index * 37.5}
                y2={180 - index * 37.5}
                stroke="currentColor"
                className="text-border"
                strokeDasharray={index === 0 ? "0" : "3 4"}
                strokeWidth=".7"
              />
              <text
                x="30"
                y={183 - index * 37.5}
                textAnchor="end"
                className="fill-muted-foreground"
                fontSize="8"
              >
                {(index * max) / 4}
              </text>
            </g>
          ))}
          <path d={`${line} L576,180 L48,180Z`} fill="url(#activityFill)" />
          <path
            d={previous}
            fill="none"
            stroke="#d3c6e7"
            strokeWidth="1.5"
            strokeDasharray="4 4"
          />
          <path d={line} fill="none" stroke="#a48ad5" strokeWidth="2" />
          {points.map(([x, y], index) => (
            <g key={buckets[index].key} data-activity-day={buckets[index].key}>
              {(index % Math.ceil(days / 7) === 0 || index === days - 1) && (
                <text
                  x={x}
                  y="204"
                  textAnchor="middle"
                  className="fill-muted-foreground"
                  fontSize="8"
                >
                  {buckets[index].label}
                </text>
              )}
              <rect
                x={x - 264 / days}
                y="10"
                width={528 / days}
                height="174"
                fill="transparent"
                onMouseEnter={() => setHover(index)}
              />
              <circle
                cx={x}
                cy={y}
                r="3"
                fill="#a48ad5"
                tabIndex={0}
                aria-label={`${buckets[index].label}: ${number(values[index])} ${metricName.toLowerCase()}`}
                onFocus={() => setHover(index)}
                onBlur={() => setHover(null)}
              />
              {hover === index && (
                <>
                  <line
                    x1={x}
                    y1="21"
                    x2={x}
                    y2="180"
                    stroke="#a48ad5"
                    strokeDasharray="3 3"
                    opacity=".4"
                  />
                  <g
                    transform={`translate(${Math.max(45, Math.min(x - 29, 545))},${Math.max(2, y - 29)})`}
                  >
                    <rect width="58" height="21" rx="5" fill="#65517f" />
                    <text
                      x="29"
                      y="14"
                      textAnchor="middle"
                      fill="white"
                      fontSize="9"
                    >
                      {number(values[index])}
                    </text>
                  </g>
                </>
              )}
            </g>
          ))}
        </svg>
      </div>
      <details className="border-t px-5 py-3 text-[10px]">
        <summary className="cursor-pointer font-medium">
          View daily values
        </summary>
        <div className="mt-3 max-h-64 overflow-auto">
          <table className="w-full text-left">
            <caption className="sr-only">
              {metricName} by calendar day in {snapshot.timeZone};
              previous-period dates are aligned by position.
            </caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">{metricName}</th>
                <th scope="col">Previous date</th>
                <th scope="col">Previous value</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((bucket) => (
                <tr key={bucket.key}>
                  <th className="py-1 font-normal" scope="row">
                    {bucket.key}
                  </th>
                  <td>{number(bucket[metric])}</td>
                  <td>{bucket.previous.key}</td>
                  <td>{number(bucket.previous[metric])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </Card>
  );
}
