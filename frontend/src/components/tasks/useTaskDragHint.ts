import { useContext, useRef, useState } from 'react';
import { AuthContext } from '../../auth/authContextShared';
import { retireTaskDragHint } from '../../auth/authApi';

const retiredUsers = new Set<number>();

export function useTaskDragHint() {
  const user = useContext(AuthContext)?.user;
  const [retired, setRetired] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const lock = useRef(false);
  const done = !user || user.task_drag_hint_done || retiredUsers.has(user.id) || retired === user.id;
  const retire = async (event: 'moved' | 'dismissed') => {
    if (!user || done || lock.current) return;
    lock.current = true;
    setFailed(false);
    try {
      await retireTaskDragHint(event);
      retiredUsers.add(user.id);
      setRetired(user.id);
    } catch { setFailed(true); }
    finally { lock.current = false; }
  };
  return { visible: !done, failed, retire };
}

export function resetTaskDragHintSessionState(): void { retiredUsers.clear(); }
