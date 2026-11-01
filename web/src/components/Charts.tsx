import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { MetricPoint } from '../lib/types';

echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

const formatBucket = (epoch: number): string => {
  const date = new Date(epoch);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

/** 资源使用趋势图：CPU / 内存双折线，使用 ECharts 原生 Canvas 渲染。 */
export function UsageChart({ points, height = 260 }: { points: MetricPoint[]; height?: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const chart = echarts.init(element, undefined, { renderer: 'canvas' });
    chartRef.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(element);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.setOption({
      backgroundColor: 'transparent',
      grid: { left: 40, right: 18, top: 28, bottom: 26 },
      legend: {
        right: 10,
        top: 0,
        textStyle: { color: '#8fa3c4', fontSize: 11 },
        itemWidth: 12,
        itemHeight: 8,
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#0e1729',
        borderColor: '#243455',
        textStyle: { color: '#dbe6f7', fontSize: 12 },
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: points.map((point) => formatBucket(point.bucket)),
        axisLine: { lineStyle: { color: '#243455' } },
        axisLabel: { color: '#7e91b3', fontSize: 10, interval: Math.max(0, Math.floor(points.length / 8) - 1) },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 100,
        splitLine: { lineStyle: { color: '#1c2942' } },
        axisLabel: { color: '#7e91b3', fontSize: 10, formatter: '{value}%' },
      },
      series: [
        {
          name: 'CPU',
          type: 'line',
          smooth: true,
          showSymbol: false,
          data: points.map((point) => Math.round(point.cpuPct * 10) / 10),
          lineStyle: { width: 2, color: '#35d6c1' },
          areaStyle: { color: 'rgba(53,214,193,0.10)' },
        },
        {
          name: '内存',
          type: 'line',
          smooth: true,
          showSymbol: false,
          data: points.map((point) => Math.round(point.memPct * 10) / 10),
          lineStyle: { width: 2, color: '#5b8cff' },
          areaStyle: { color: 'rgba(91,140,255,0.08)' },
        },
      ],
    });
  }, [points]);

  return <div className="chart" ref={containerRef} style={{ height }} />;
}
