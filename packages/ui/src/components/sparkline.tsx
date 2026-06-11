import * as React from 'react';

export interface SparklineProps extends Omit<React.SVGProps<SVGSVGElement>, 'fill'> {
  data: number[];
  width?: number;
  height?: number;
  /** vẽ vùng tô nhạt dưới đường */
  area?: boolean;
}

/**
 * Sparkline SVG thuần (docs/ui §4.5 — không thêm chart lib cho nhu cầu nhỏ).
 * Dùng currentColor → màu theo text của container (vd tone chip). Props-thuần.
 */
export function Sparkline({
  data,
  width = 96,
  height = 28,
  area = true,
  className,
  ...props
}: SparklineProps) {
  if (data.length < 2) {
    return <svg width={width} height={height} className={className} aria-hidden {...props} />;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const stepX = width / (data.length - 1);
  const pad = 2;
  const usableH = height - pad * 2;

  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = pad + usableH - ((v - min) / span) * usableH;
    return [x, y] as const;
  });

  const line = points
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(' ');
  const areaPath = `${line} L${width} ${height} L0 ${height} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      preserveAspectRatio="none"
      className={className}
      aria-hidden
      {...props}
    >
      {area && <path d={areaPath} fill="currentColor" opacity={0.12} />}
      <path
        d={line}
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
