import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import HeroImage from '../components/HeroImage';

describe('HeroImage', () => {
  it('renders eagerly with a high fetch priority and reserved dimensions', () => {
    render(<HeroImage alt="A field" />);

    const img = screen.getByRole('img', { name: 'A field' });
    expect(img).toHaveAttribute('loading', 'eager');
    expect(img).toHaveAttribute('fetchpriority', 'high');
    expect(img).toHaveAttribute('width');
    expect(img).toHaveAttribute('height');
  });

  it('offers responsive widths down to 640w so mobile does not fall back to the full 1920w file', () => {
    render(<HeroImage alt="A field" />);

    const img = screen.getByRole('img', { name: 'A field' });
    const srcSet = img.getAttribute('srcset') ?? '';
    expect(srcSet).toContain('640w');
    expect(srcSet).toContain('960w');
    expect(srcSet).toContain('1280w');
    expect(srcSet).toContain('1920w');
    expect(img).toHaveAttribute('sizes', '100vw');
  });

  it('starts transparent and fades in once the image has loaded', () => {
    render(<HeroImage alt="A field" />);

    const img = screen.getByRole('img', { name: 'A field' });
    expect(img).toHaveStyle({ opacity: 0 });

    fireEvent.load(img);

    expect(img).toHaveStyle({ opacity: 1 });
  });

  it('renders an overlay above the image when overlaySx is provided', () => {
    const { container } = render(
      <HeroImage alt="" overlaySx={{ backgroundImage: 'linear-gradient(red, blue)' }} />,
    );

    const overlay = container.querySelector('[aria-hidden="true"]');
    expect(overlay).not.toBeNull();
  });

  // Regression: the auth pages used to pin the image to the viewport while the
  // overlay stayed bound to the container. Whenever the two containing blocks
  // disagreed in width - e.g. while MUI's modal scroll lock pads <body> - the
  // undimmed image showed through as a strip along the right edge.
  it('positions the overlay in the same containing block as the image', () => {
    render(
      <HeroImage alt="A field" position="fixed" overlaySx={{ backgroundColor: 'red' }} />,
    );

    const img = screen.getByRole('img', { name: 'A field' });
    const overlay = screen.getByTestId('hero-image-overlay');

    expect(img).toHaveStyle({ position: 'fixed' });
    expect(overlay).toHaveStyle({ position: 'fixed' });
  });
});
