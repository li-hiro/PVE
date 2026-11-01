import { describe, expect, it } from 'vitest';
import {
  formatDate,
  formatDateTime,
  formatDuration,
  formatMemory,
  formatPercent,
  formatStorage,
  formatUptime,
  percentOf,
  relativeTime,
  truncate,
} from './format';

describe('format helpers', () => {
  it('formats date time with zero-padded local components', () => {
    expect(formatDateTime('2026-03-01T08:05:09')).toBe('2026-03-01 08:05:09');
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime('not-a-date')).toBe('—');
    expect(formatDate('2026-03-01T08:05:09')).toBe('2026-03-01');
  });

  it('renders relative time buckets', () => {
    const now = new Date('2026-03-01T12:00:00').getTime();
    expect(relativeTime('2026-03-01T11:59:30', now)).toBe('30 秒前');
    expect(relativeTime('2026-03-01T11:10:00', now)).toBe('50 分钟前');
    expect(relativeTime('2026-03-01T08:00:00', now)).toBe('4 小时前');
    expect(relativeTime('2026-02-27T12:00:00', now)).toBe('2 天前');
    expect(relativeTime(null, now)).toBe('—');
  });

  it('normalizes memory and storage units', () => {
    expect(formatMemory(512)).toBe('512 MiB');
    expect(formatMemory(1024)).toBe('1 GiB');
    expect(formatMemory(1536)).toBe('1.5 GiB');
    expect(formatMemory(1024 * 1024)).toBe('1.0 TiB');
    expect(formatMemory(null)).toBe('—');
    expect(formatStorage(512)).toBe('512 GB');
    expect(formatStorage(2048)).toBe('2.0 TiB');
  });

  it('formats percentages, uptime and durations', () => {
    expect(formatPercent(72.345)).toBe('72.3%');
    expect(formatPercent(null)).toBe('—');
    expect(formatUptime(90)).toBe('1 分钟');
    expect(formatUptime(3700)).toBe('1 小时 1 分钟');
    expect(formatUptime(90_000)).toBe('1 天 1 小时');
    expect(formatUptime(0)).toBe('—');
    expect(formatDuration(500)).toBe('500 ms');
    expect(formatDuration(1500)).toBe('1.5 s');
    expect(formatDuration(65_000)).toBe('1 分 5 秒');
  });

  it('truncates long text and calculates quota percentages', () => {
    expect(truncate('short', 10)).toBe('short');
    expect(truncate('abcdefghijklmnop', 10)).toBe('abcdefghi…');
    expect(percentOf(4, 8)).toBe(50);
    expect(percentOf(4, null)).toBeNull();
    expect(percentOf(4, 0)).toBeNull();
  });
});
