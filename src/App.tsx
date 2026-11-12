import { useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { addsTask, emptyPage, localDate, newTask } from './note';
import type { Page, Side, Task } from './note';
import { SaveQueue } from './save-queue';
import type { SaveStatus } from './save-queue';

export function App() {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<Page | null>(null);
  const [loadError, setLoadError] = useState('');
  const [status, setStatus] = useState<SaveStatus>({ kind: 'saved' });
  const [closing, setClosing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [today, setToday] = useState(localDate);
  const closingRef = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const cover = useRef<HTMLButtonElement>(null);
  const saver = useRef<SaveQueue<Page> | null>(null);
  if (!saver.current) saver.current = new SaveQueue(value => invoke('save_page', { page: value }), setStatus);
  const native = isTauri();

  async function load(date: string) {
    setLoading(true);
    setLoadError('');
    try {
      const stored = native ? await invoke<Page | null>('load_page', { date }) : null;
      setPage(stored ?? emptyPage(date));
    } catch (error) {
      setLoadError(`기록을 열지 못했습니다. 기존 기록은 덮어쓰지 않습니다. ${String(error)}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(today); }, []);
  useEffect(() => {
    const interval = window.setInterval(() => setToday(localDate()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!native) return;
    const subscription = listen('save-before-exit', async () => {
      if (closingRef.current) return;
      closingRef.current = true;
      setClosing(true);
      try {
        await saver.current!.flush();
        await invoke('quit_after_save');
      } catch {
        closingRef.current = false;
        setClosing(false);
      }
    });
    return () => { void subscription.then(unlisten => unlisten()); };
  }, [native]);

  useEffect(() => {
    if (open) heading.current?.focus();
    else cover.current?.focus();
  }, [open]);

  function update(next: Page) {
    if (closingRef.current) return;
    setPage(next);
    if (native) saver.current!.enqueue(next);
  }

  async function openToday() {
    try {
      await saver.current!.flush();
      await load(localDate());
    } catch { /* Keep the current page and its unsaved edits visible. */ }
  }

  async function openNotebook() {
    setOpen(true);
    if (page && page.date !== localDate()) await openToday();
  }

  return <main>
    {!native && <aside className="preview">사각 · 개발용 화면 미리보기</aside>}
    {status.kind === 'error' && <div className="error" role="alert"><p>입력한 내용은 화면에 남아 있습니다. 앱을 닫기 전에 다시 저장해 주세요.</p><p>{status.message}</p><button disabled={closing} onClick={() => void saver.current!.flush().catch(() => {})}>다시 저장</button></div>}
    {!open ? <div className="cover-stage">
      <button className="cover" ref={cover} onClick={() => void openNotebook()} aria-label="사각 노트 열기">
        <span className="cover-name">사각</span>
        <span className="cover-tagline">펼쳐 쓰는 나의 하루.</span>
        <span className="cover-hint">오늘의 노트 열기 <span aria-hidden="true">↗</span></span>
      </button>
    </div> : <div className="desk">
      <header className="toolbar">
        <button onClick={() => setOpen(false)}>← 표지로</button>
        <h1 ref={heading} tabIndex={-1}>사각 <span>펼쳐 쓰는 나의 하루.</span></h1>
        <div className="save-state" role="status" aria-live="polite">
          {!native ? '미리보기 · 저장되지 않음' : closing ? '저장 후 닫는 중…' : loading ? '기록 여는 중…' : status.kind === 'saving' ? '저장 중…' : status.kind === 'error' ? '저장하지 못함' : '기록 저장됨'}
        </div>
      </header>
      {!native && <p className="preview-note">화면 미리보기입니다. 기록은 데스크톱 앱에서만 저장됩니다.</p>}
      {loadError ? <div className="error" role="alert"><p>{loadError}</p><button onClick={() => void load(localDate())}>다시 열기</button></div> : loading ? <p role="status">오늘의 기록을 열고 있어요.</p> : page && <>
        {page.date !== today && <div className="day-change">날짜가 바뀌었습니다. 현재는 {page.date} 기록입니다. <button disabled={closing} onClick={() => void openToday()}>저장하고 오늘 열기</button></div>}
        <div className="spread" aria-label={`${page.date} 일일 노트`}>
          {(['left', 'right'] as const).map((side, index) => <NoteSide key={`${page.date}-${side}`} side={side} value={page[side]} date={page.date} index={index} disabled={closing}
            onChange={value => update({ ...page, [side]: value })} />)}
        </div>
        <p className="desk-foot">하루의 두 면을, 한 권에. <span>Enter로 다음 할 일 · Shift + Enter로 줄바꿈</span></p>
      </>}
    </div>}
  </main>;
}

function NoteSide({ side, value, date, index, disabled, onChange }: {
  side: 'left' | 'right'; value: Side; date: string; index: number; disabled: boolean; onChange: (value: Side) => void;
}) {
  const inputs = useRef(new Map<string, HTMLTextAreaElement>());
  const sideName = side === 'left' ? '왼쪽' : '오른쪽';
  const displayDate = new Date(`${date}T12:00:00`);
  function changeTask(id: string, patch: Partial<Task>) {
    onChange({ ...value, tasks: value.tasks.map(task => task.id === id ? { ...task, ...patch } : task) });
  }
  function addTask(after?: string) {
    const task = newTask();
    const tasks = [...value.tasks];
    tasks.splice(after ? tasks.findIndex(item => item.id === after) + 1 : tasks.length, 0, task);
    onChange({ ...value, tasks });
    requestAnimationFrame(() => inputs.current.get(task.id)?.focus());
  }

  return <section className="page" aria-label={`${sideName} 페이지`}>
    <div className="page-heading">
      {index === 0 ? <div className="date"><time dateTime={date}>{date.replaceAll('-', '. ')}</time><span>{displayDate.toLocaleDateString('ko-KR', { weekday: 'long' })}</span></div> : <span className="printed">MY DAILY NOTE</span>}
      <input className="role handwriting" aria-label={`${sideName} 역할 제목`} value={value.title} disabled={disabled} onChange={e => onChange({ ...value, title: e.target.value })} />
    </div>
    <div className="entries" aria-label={`${sideName} 할 일 목록`}>
      {value.tasks.map((task, i) => <div className={`entry ${task.done ? 'done' : ''}`} key={task.id}>
        <input className="cue handwriting" aria-label={`${sideName} ${i + 1}번 보조 칸`} placeholder="·" value={task.cue} disabled={disabled} onChange={e => changeTask(task.id, { cue: e.target.value })} />
        <textarea className="task handwriting" ref={node => { if (node) inputs.current.set(task.id, node); else inputs.current.delete(task.id); }} aria-label={`${sideName} ${i + 1}번 할 일`} placeholder="오늘의 할 일을 적어 보세요" rows={2} value={task.text} disabled={disabled}
          onChange={e => changeTask(task.id, { text: e.target.value })}
          onKeyDown={e => { if (addsTask(e.nativeEvent)) { e.preventDefault(); addTask(task.id); } }} />
        <input className="check" type="checkbox" aria-label={`${sideName} ${i + 1}번 완료`} checked={task.done} disabled={disabled} onChange={e => changeTask(task.id, { done: e.target.checked })} />
      </div>)}
      <button className="add-task" disabled={disabled} onClick={() => addTask()}>+ 할 일 추가</button>
    </div>
    <div className="notes">
      <label className="printed" htmlFor={`${side}-memo`}>MEMO</label>
      <textarea id={`${side}-memo`} className="handwriting" aria-label={`${sideName} 메모`} placeholder="기억하고 싶은 이야기" value={value.memo} disabled={disabled} onChange={e => onChange({ ...value, memo: e.target.value })} />
    </div>
    <footer className="page-foot"><span>펼쳐 쓰는 나의 하루.</span><span>{String(index + 1).padStart(2, '0')}</span></footer>
  </section>;
}
