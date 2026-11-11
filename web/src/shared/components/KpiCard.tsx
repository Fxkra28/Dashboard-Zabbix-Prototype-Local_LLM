import { orNoData } from './NoData';

export default function KpiCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="kpi" style={accent ? ({ ['--accent' as string]: accent } as React.CSSProperties) : undefined}>
      <span className="label">{label}</span>
      <span className="value">{orNoData(value)}</span>
      {sub && <span className="sub">{sub}</span>}
    </div>
  );
}
