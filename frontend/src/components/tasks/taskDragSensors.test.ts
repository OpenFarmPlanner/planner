import { describe, expect, it, vi } from 'vitest';
import type { MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from 'react';
import { TaskCardMouseSensor, TaskCardTouchSensor, canStartCardDrag } from './taskDragSensors';

function card(): { root: HTMLElement; body: HTMLElement; link: HTMLElement; linkText: HTMLElement; menuButton: HTMLElement } {
  const root = document.createElement('article');
  root.innerHTML = '<p data-body>Jäten</p><a href="/app/crops?cropId=1"><span data-text>Salat</span></a>'
    + '<button type="button"><svg></svg></button>';
  document.body.appendChild(root);
  return {
    root,
    body: root.querySelector('[data-body]') as HTMLElement,
    link: root.querySelector('a') as HTMLElement,
    linkText: root.querySelector('[data-text]') as HTMLElement,
    menuButton: root.querySelector('svg') as unknown as HTMLElement,
  };
}

function mouseDown(currentTarget: Element, target: Element, button = 0): ReactMouseEvent {
  return { currentTarget, nativeEvent: { target, button } } as unknown as ReactMouseEvent;
}

function touchStart(currentTarget: Element, target: Element, touches = 1): ReactTouchEvent {
  return { currentTarget, nativeEvent: { target, touches: { length: touches } } } as unknown as ReactTouchEvent;
}

describe('task card drag sensors', () => {
  it('starts a drag from the card body but never from its links or menu button', () => {
    const { root, body, link, linkText, menuButton } = card();
    expect(canStartCardDrag(root, body)).toBe(true);
    expect(canStartCardDrag(root, root)).toBe(true);
    expect(canStartCardDrag(root, link)).toBe(false);
    expect(canStartCardDrag(root, linkText)).toBe(false);
    expect(canStartCardDrag(root, menuButton)).toBe(false);
  });

  it('ignores presses that bubble from a portal such as the open card menu', () => {
    const { root } = card();
    const menuItem = document.createElement('li');
    menuItem.setAttribute('role', 'menuitem');
    const backdrop = document.createElement('div');
    document.body.append(menuItem, backdrop);
    expect(canStartCardDrag(root, menuItem)).toBe(false);
    expect(canStartCardDrag(root, backdrop)).toBe(false);
  });

  it('applies the rule to mouse presses and keeps the primary-button check', () => {
    const { root, body, link } = card();
    const [activator] = TaskCardMouseSensor.activators;
    const onActivation = vi.fn();
    expect(activator.handler(mouseDown(root, body), { onActivation })).toBe(true);
    expect(onActivation).toHaveBeenCalledTimes(1);
    expect(activator.handler(mouseDown(root, link), { onActivation })).toBe(false);
    expect(activator.handler(mouseDown(root, body, 2), { onActivation })).toBe(false);
    expect(onActivation).toHaveBeenCalledTimes(1);
  });

  it('applies the rule to touches and ignores multi-touch gestures', () => {
    const { root, body, link } = card();
    const [activator] = TaskCardTouchSensor.activators;
    expect(activator.handler(touchStart(root, body), {})).toBe(true);
    expect(activator.handler(touchStart(root, link), {})).toBe(false);
    expect(activator.handler(touchStart(root, body, 2), {})).toBe(false);
  });
});
