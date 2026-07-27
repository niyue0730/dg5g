'use client';

import { useEffect } from 'react';

const dragSurfaceSelector = [
  '.scene-slide-rail',
  '.scene-rail',
  '.scene-teacher-stage',
  '.scene-teacher-inspector',
  '.teacher-inspector-panel',
  '.teacher-new-lesson > div',
  '.scene-follow-path',
  '.scene-follow-activity',
  '.scene-teacher-controls',
  '.scene-follow-controls',
  '.graph-detail-panel',
  '.self-study-textbook-body',
  '.self-study-sections',
  '.self-study-renderer .self-study-head nav',
  '.self-study-glossary',
  '.output-review-fields',
  '.demo-control-steps',
  '.graph-mode-rail',
  '.public-platform-flow',
  '.p1-task-rail',
].join(',');

const ignoredTargetSelector = 'input, textarea, select, option, [contenteditable="true"]';
const dragThreshold = 6;

interface DragState {
  surface: HTMLElement;
  pointerId: number;
  startX: number;
  startY: number;
  startScrollLeft: number;
  startScrollTop: number;
  canScrollX: boolean;
  canScrollY: boolean;
  dragged: boolean;
}

export function PointerDragScroll() {
  useEffect(() => {
    let state: DragState | undefined;
    let suppressClick = false;

    function onPointerDown(event: PointerEvent) {
      if (event.button !== 0 || event.pointerType === 'touch') return;
      const target = event.target;
      if (!(target instanceof Element) || target.closest(ignoredTargetSelector)) return;
      const surface = target.closest<HTMLElement>(dragSurfaceSelector);
      if (!surface) return;
      const canScrollX = surface.scrollWidth > surface.clientWidth + 2;
      const canScrollY = surface.scrollHeight > surface.clientHeight + 2;
      if (!canScrollX && !canScrollY) return;

      state = {
        surface,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startScrollLeft: surface.scrollLeft,
        startScrollTop: surface.scrollTop,
        canScrollX,
        canScrollY,
        dragged: false,
      };
      surface.setPointerCapture?.(event.pointerId);
    }

    function onPointerMove(event: PointerEvent) {
      if (!state || event.pointerId !== state.pointerId) return;
      const deltaX = event.clientX - state.startX;
      const deltaY = event.clientY - state.startY;
      if (!state.dragged && Math.hypot(deltaX, deltaY) < dragThreshold) return;
      state.dragged = true;
      state.surface.classList.add('is-pointer-dragging');
      if (state.canScrollX) state.surface.scrollLeft = state.startScrollLeft - deltaX;
      if (state.canScrollY) state.surface.scrollTop = state.startScrollTop - deltaY;
      event.preventDefault();
    }

    function finishPointer(event: PointerEvent) {
      if (!state || event.pointerId !== state.pointerId) return;
      suppressClick = state.dragged;
      state.surface.classList.remove('is-pointer-dragging');
      if (state.surface.hasPointerCapture?.(event.pointerId)) {
        state.surface.releasePointerCapture(event.pointerId);
      }
      state = undefined;
    }

    function onClick(event: MouseEvent) {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('pointermove', onPointerMove, { passive: false });
    document.addEventListener('pointerup', finishPointer);
    document.addEventListener('pointercancel', finishPointer);
    document.addEventListener('click', onClick, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', finishPointer);
      document.removeEventListener('pointercancel', finishPointer);
      document.removeEventListener('click', onClick, true);
    };
  }, []);

  return null;
}
