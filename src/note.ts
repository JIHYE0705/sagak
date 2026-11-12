export type Task = { id: string; cue: string; text: string; done: boolean };
export type Side = { title: string; tasks: Task[]; memo: string };
export type Page = { date: string; left: Side; right: Side };

export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function newTask(): Task {
  return { id: crypto.randomUUID(), cue: '', text: '', done: false };
}

export function emptyPage(date: string): Page {
  return {
    date,
    left: { title: '회사 일', tasks: [newTask()], memo: '' },
    right: { title: '나의 일', tasks: [newTask()], memo: '' },
  };
}

export function addsTask(event: { key: string; shiftKey: boolean; isComposing: boolean; keyCode: number }): boolean {
  return event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229;
}
