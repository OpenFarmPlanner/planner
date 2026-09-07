import { render, screen } from '@testing-library/react';
import { RichTextViewer } from '../components/data-grid/RichTextViewer';

/**
 * Notes are written by one project member and rendered for the others, so the
 * viewer is a stored-XSS sink. Both properties asserted here come from
 * `react-markdown` defaults (`defaultUrlTransform`, and raw HTML being ignored
 * without `rehype-raw`) rather than from code in this repository — a future
 * `urlTransform` override or a `rehype-raw` plugin would remove them silently.
 * These tests fail if that happens.
 */
describe('RichTextViewer sanitization', () => {
  it('strips javascript: URLs from note links', () => {
    render(<RichTextViewer value="[klick mich](javascript:alert(document.cookie))" />);

    const link = screen.getByText('klick mich').closest('a');
    expect(link?.getAttribute('href') ?? '').not.toMatch(/^javascript:/i);
  });

  it('strips javascript: URLs regardless of casing or leading whitespace', () => {
    render(<RichTextViewer value="[klick mich](JaVaScRiPt:alert(1))" />);

    const link = screen.getByText('klick mich').closest('a');
    expect(link?.getAttribute('href') ?? '').not.toMatch(/^\s*javascript:/i);
  });

  it('does not render raw HTML embedded in a note', () => {
    const { container } = render(
      <RichTextViewer value={'<img src=x onerror="alert(1)"> <script>alert(2)</script>'} />,
    );

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
  });

  it('still renders ordinary external links and opens them safely', () => {
    render(<RichTextViewer value="[Saatgut](https://example.org/seeds)" />);

    const link = screen.getByText('Saatgut').closest('a');
    expect(link).toHaveAttribute('href', 'https://example.org/seeds');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
