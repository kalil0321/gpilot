"use client";

import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { BillingPeriod } from "@/lib/gpilot/types";

interface BillingChartCardProps {
  periods: BillingPeriod[];
}

/**
 * Stacked bar of cost per service per month. Driven entirely by
 * `agent.state.billing_periods`. Empty-states gracefully when the
 * agent hasn't run `fetch_billing` yet.
 *
 * Recharts wants one row per X-axis bucket with each series as a key,
 * so we pivot the agent's flat (month, service, cost_usd) rows into
 * { month, "<service A>": cost, "<service B>": cost, ... } shape.
 */
export function BillingChartCard({ periods }: BillingChartCardProps) {
  const { chartData, chartConfig, services } = useMemo(
    () => pivot(periods),
    [periods],
  );

  if (chartData.length === 0) {
    return (
      <Card className="border-0 bg-card shadow-none">
        <CardHeader>
          <CardTitle>Billing</CardTitle>
          <CardDescription>
            Ask <span className="font-mono text-xs">show me last two months
            of spend</span> to populate this chart.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="border-0 bg-card shadow-none">
      <CardHeader>
        <CardTitle>Cost by service</CardTitle>
        <CardDescription>Stacked monthly spend across services.</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-72 w-full">
          <BarChart data={chartData}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="month"
              tickLine={false}
              axisLine={false}
              tickMargin={10}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={6}
              tickFormatter={(v) => `$${v}`}
            />
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent indicator="dashed" />}
            />
            <ChartLegend content={<ChartLegendContent />} />
            {services.map((service, idx) => (
              <Bar
                key={service}
                dataKey={service}
                stackId="cost"
                fill={`var(--chart-${(idx % 5) + 1})`}
                radius={
                  idx === services.length - 1 ? [6, 6, 0, 0] : [0, 0, 0, 0]
                }
              />
            ))}
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

function pivot(periods: BillingPeriod[]) {
  const monthsOrder: string[] = [];
  const services: string[] = [];
  const monthsSeen = new Set<string>();
  const servicesSeen = new Set<string>();

  for (const p of periods) {
    if (!monthsSeen.has(p.month)) {
      monthsSeen.add(p.month);
      monthsOrder.push(p.month);
    }
    if (!servicesSeen.has(p.service)) {
      servicesSeen.add(p.service);
      services.push(p.service);
    }
  }

  const chartData = monthsOrder.map((month) => {
    const row: Record<string, string | number> = { month };
    for (const s of services) row[s] = 0;
    for (const p of periods) {
      if (p.month === month) row[p.service] = Number(p.cost_usd.toFixed(2));
    }
    return row;
  });

  const chartConfig: ChartConfig = {};
  services.forEach((s, idx) => {
    chartConfig[s] = {
      label: s,
      color: `var(--chart-${(idx % 5) + 1})`,
    };
  });

  return { chartData, chartConfig, services };
}
