import { MouseSensor, TouchSensor } from '@dnd-kit/core';

// The whole task card is the drag activator, so presses that start on one of
// its links or buttons (crop/area links, the card menu) must stay clicks/taps.
// React bubbles events out of portals, so presses inside the card's open menu
// (or its backdrop) reach the card too: only the card's own DOM may start a drag.
const INTERACTIVE_SELECTOR = 'a, button, input, select, textarea, [role="menuitem"], [data-no-drag]';

export function canStartCardDrag(card: EventTarget | null, target: EventTarget | null): boolean {
  return card instanceof Element && target instanceof Element && card.contains(target)
    && target.closest(INTERACTIVE_SELECTOR) === null;
}

const [mouseActivator] = MouseSensor.activators;
const [touchActivator] = TouchSensor.activators;

export class TaskCardMouseSensor extends MouseSensor {
  static activators: typeof MouseSensor.activators = [{
    eventName: 'onMouseDown',
    handler: (event, options) => canStartCardDrag(event.currentTarget, event.nativeEvent.target)
      && mouseActivator.handler(event, options),
  }];
}

export class TaskCardTouchSensor extends TouchSensor {
  static activators: typeof TouchSensor.activators = [{
    eventName: 'onTouchStart',
    handler: (event, options) => canStartCardDrag(event.currentTarget, event.nativeEvent.target)
      && touchActivator.handler(event, options),
  }];
}
