import { useEffect, useRef, useState } from 'react';

/**
 * Upper band of the viewport that counts as "reading": below the sticky
 * topbar and above the lower half, so the section whose heading the user is
 * reading wins over the one merely peeking in at the bottom.
 */
const ACTIVE_SECTION_ROOT_MARGIN = '-72px 0px -55% 0px';

/**
 * Tracks which settings section is currently in view. Falls back to the first
 * section where IntersectionObserver is unavailable.
 */
export function useActiveSettingsSection(sectionIds: readonly string[]) {
  const [activeId, setActiveId] = useState<string | null>(sectionIds[0] ?? null);
  const visibility = useRef(new Map<string, boolean>());
  const idsKey = sectionIds.join('|');

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') {
      return undefined;
    }
    const ids = idsKey ? idsKey.split('|') : [];
    const visible = visibility.current;
    visible.clear();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          visible.set(entry.target.id, entry.isIntersecting);
        }
        const firstVisible = ids.find((id) => visible.get(id));
        if (firstVisible) {
          setActiveId(firstVisible);
        }
      },
      { rootMargin: ACTIVE_SECTION_ROOT_MARGIN, threshold: 0 },
    );
    for (const id of ids) {
      const element = document.getElementById(id);
      if (element) {
        observer.observe(element);
      }
    }
    return () => observer.disconnect();
  }, [idsKey]);

  return [activeId, setActiveId] as const;
}
