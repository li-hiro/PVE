import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  Badge,
  GuestStatusBadge,
  Modal,
  Pagination,
  ProgressBar,
  ResultBadge,
  SeverityBadge,
} from './common';

describe('common UI components', () => {
  it('renders tone-based badges', () => {
    const { container } = render(<Badge tone="success">正常</Badge>);
    expect(screen.getByText('正常')).toBeInTheDocument();
    expect(container.querySelector('.badge-success')).not.toBeNull();
  });

  it('maps guest status codes to Chinese labels', () => {
    render(<GuestStatusBadge status="running" />);
    expect(screen.getByText('运行中')).toBeInTheDocument();
  });

  it('maps audit results and alert severity', () => {
    render(
      <>
        <ResultBadge result="denied" />
        <SeverityBadge severity="critical" />
      </>,
    );
    expect(screen.getByText('拒绝')).toBeInTheDocument();
    expect(screen.getByText('严重')).toBeInTheDocument();
  });

  it('fills the progress bar proportionally and shows 不限 without a limit', () => {
    const { container, rerender } = render(<ProgressBar label="CPU" value={70} max={100} />);
    const fill = container.querySelector('.progress-fill') as HTMLElement;
    expect(fill.style.width).toBe('70%');
    expect(screen.getByText('70.0%')).toBeInTheDocument();

    rerender(<ProgressBar label="CPU" value={70} max={null} />);
    expect(screen.getByText('不限')).toBeInTheDocument();
    expect((container.querySelector('.progress-fill') as HTMLElement).style.width).toBe('0%');
  });

  it('disables pagination controls at the boundaries', () => {
    const onChange = vi.fn();
    const { rerender } = render(<Pagination page={1} pageSize={10} total={25} onChange={onChange} />);
    expect(screen.getByText('共 25 条 · 第 1/3 页')).toBeInTheDocument();
    expect(screen.getByText('上一页')).toBeDisabled();

    fireEvent.click(screen.getByText('下一页'));
    expect(onChange).toHaveBeenCalledWith(2);

    rerender(<Pagination page={3} pageSize={10} total={25} onChange={onChange} />);
    expect(screen.getByText('下一页')).toBeDisabled();
  });

  it('renders a modal only when open and exposes the close affordance', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Modal open={false} title="标题" onClose={onClose}>
        内容
      </Modal>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();

    rerender(
      <Modal open title="标题" onClose={onClose}>
        内容
      </Modal>,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('关闭'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
