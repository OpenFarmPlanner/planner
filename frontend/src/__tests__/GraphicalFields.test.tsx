import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act, useState, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { GraphicalCanvasTools } from '../pages/GraphicalCanvasTools';
import GraphicalFields from "../pages/GraphicalFields";
import type { BedLayoutEntry, FieldLayoutEntry, LocationBoundaryOrigin } from "../api/api";
import type { GraphicalCameraState } from "../pages/graphicalFieldsGeometry";

interface LayoutData {
  bed_layouts: BedLayoutEntry[];
  field_layouts: FieldLayoutEntry[];
  location_boundary?: LocationBoundaryOrigin | null;
}

const mockUseHierarchyData = vi.fn();
const listAreaPlansMock = vi.hoisted(() => vi.fn());
const { listByLocationMock, saveByLocationMock } = vi.hoisted(() => ({
  listByLocationMock: vi.fn(async (): Promise<{ data: LayoutData }> => ({
    data: { bed_layouts: [], field_layouts: [] },
  })),
  saveByLocationMock: vi.fn<(locationId: number, body: LayoutData) => Promise<{ data: LayoutData }>>(async () => ({
    data: { bed_layouts: [], field_layouts: [] },
  })),
}));
const mockStageApi = {
  pointer: { x: 0, y: 0 },
  handlers: {} as {
    onMouseDown?: (event: { evt: MouseEvent; target: { getStage: () => object } }) => void;
    onMouseMove?: (event: { evt: MouseEvent; target: { getStage: () => object } }) => void;
    onMouseUp?: (event: { evt: MouseEvent; target: { getStage: () => object } }) => void;
    onTouchStart?: (event: { evt: TouchEvent; target: { getStage: () => object } }) => void;
    onTouchMove?: (event: { evt: TouchEvent; target: { getStage: () => object } }) => void;
    onTouchEnd?: (event: { evt: TouchEvent }) => void;
  },
  setPointer(x: number, y: number) {
    this.pointer = { x, y };
  },
};

type MockDragTarget = {
  position: (position: { x: number; y: number }) => void;
  x: () => number;
  y: () => number;
};
type MockDragEvent = { evt?: Event; target: MockDragTarget; currentTarget?: MockDragTarget };

const mockKonvaNodes: Record<string, {
  getPosition: () => { x: number; y: number };
  setPosition: (position: { x: number; y: number }) => void;
  handlers: {
    onDragMove?: (event: MockDragEvent) => void;
    onDragEnd?: (event: MockDragEvent) => void;
  };
}> = {};

const createKonvaTarget = (positionRef: {
  current: { x: number; y: number };
}) => ({
  position: ({ x, y }: { x: number; y: number }) => {
    positionRef.current = { x, y };
  },
  x: () => positionRef.current.x,
  y: () => positionRef.current.y,
});

const LOCATION_EDIT_MODE_BANNER =
  "Grafikbearbeitung aktiv: Parzellen und Beete dieses Standorts können verschoben werden.";

const createTouchLikeEvent = (
  type: string,
  points: Array<{ clientX: number; clientY: number }>,
): TouchEvent => {
  const event = new Event(type, { bubbles: true, cancelable: true }) as TouchEvent;
  Object.defineProperty(event, "touches", {
    value: points,
    configurable: true,
  });
  return event;
};

vi.mock("../components/hierarchy/hooks/useHierarchyData", () => ({
  useHierarchyData: () => mockUseHierarchyData(),
}));

vi.mock("../api/api", async () => {
  const actual =
    await vi.importActual<typeof import("../api/api")>("../api/api");
  return {
    ...actual,
    plantingPlanAPI: { ...actual.plantingPlanAPI, listForArea: listAreaPlansMock },
    layoutAPI: {
      ...actual.layoutAPI,
      listByLocation: listByLocationMock,
      saveByLocation: saveByLocationMock,
    },
  };
});

vi.mock("react-konva", async () => {
  const React = await import("react");

  type MockNodeProps = Record<string, unknown> & { children?: React.ReactNode };

  const MockNode = React.forwardRef<HTMLDivElement, MockNodeProps>(
    ({ children, ...props }, ref) => {
      const {
        cornerRadius,
        listening,
        scaleX,
        scaleY,
        onTap,
        onDragMove,
        onDragEnd,
        onDblTap,
        onDblClick,
        _useStrictMode,
        x,
        y,
        ...domProps
      } = props;
      void cornerRadius;
      void listening;
      void scaleX;
      void scaleY;
      void onTap;
      void onDblTap;
      void onDblClick;
      void _useStrictMode;

      const testId =
        typeof props["data-testid"] === "string" ? props["data-testid"] : null;
      const positionRef = React.useRef({
        x: Number(x ?? 0),
        y: Number(y ?? 0),
      });

      React.useEffect(() => {
        positionRef.current = { x: Number(x ?? 0), y: Number(y ?? 0) };
      }, [x, y]);

      React.useEffect(() => {
        if (!testId) return;
        mockKonvaNodes[testId] = {
          getPosition: () => positionRef.current,
          setPosition: (position) => {
            positionRef.current = position;
          },
          handlers: {
            onDragMove: typeof onDragMove === "function" ? ((event: MockDragEvent) =>
              (onDragMove as (event: MockDragEvent) => void)({ currentTarget: event.target, ...event })) : undefined,
            onDragEnd: typeof onDragEnd === "function" ? ((event: MockDragEvent) =>
              (onDragEnd as (event: MockDragEvent) => void)({ currentTarget: event.target, ...event })) : undefined,
          },
        };
        return () => {
          delete mockKonvaNodes[testId];
        };
      }, [testId, onDragMove, onDragEnd]);

      return (
        <div
          ref={ref}
          data-x={String(x ?? 0)}
          data-y={String(y ?? 0)}
          data-strict-mode={String(Boolean(_useStrictMode))}
          {...domProps}
        >
          {children}
        </div>
      );
    },
  );

  const MockStage = React.forwardRef<object, MockNodeProps>(
    (
      {
        children,
        onMouseDown,
        onMouseMove,
        onMouseUp,
        onTouchStart,
        onTouchMove,
        onTouchEnd,
        x,
        y,
        scaleX,
        scaleY,
        ...props
      },
      ref,
    ) => {
      React.useEffect(() => {
        mockStageApi.handlers.onMouseDown =
          onMouseDown as typeof mockStageApi.handlers.onMouseDown;
        mockStageApi.handlers.onMouseMove =
          onMouseMove as typeof mockStageApi.handlers.onMouseMove;
        mockStageApi.handlers.onMouseUp =
          onMouseUp as typeof mockStageApi.handlers.onMouseUp;
        mockStageApi.handlers.onTouchStart =
          onTouchStart as typeof mockStageApi.handlers.onTouchStart;
        mockStageApi.handlers.onTouchMove =
          onTouchMove as typeof mockStageApi.handlers.onTouchMove;
        mockStageApi.handlers.onTouchEnd =
          onTouchEnd as typeof mockStageApi.handlers.onTouchEnd;
      }, [onMouseDown, onMouseMove, onMouseUp, onTouchEnd, onTouchMove, onTouchStart]);

      React.useImperativeHandle(ref, () => ({
        getPointerPosition: () => mockStageApi.pointer,
        stopDrag: () => undefined,
        find: () => [],
        batchDraw: () => undefined,
      }));

      const stageTarget = {
        getStage: () => stageTarget,
      };

      return (
        <div
          data-testid="konva-stage"
          data-x={String(x ?? 0)}
          data-y={String(y ?? 0)}
          data-scale-x={String(scaleX ?? 1)}
          data-scale-y={String(scaleY ?? 1)}
          draggable={Boolean(props.draggable)}
          onMouseDown={(event) => {
            mockStageApi.setPointer(event.clientX, event.clientY);
            onMouseDown?.({ evt: event.nativeEvent, target: stageTarget });
          }}
          onMouseMove={(event) => {
            mockStageApi.setPointer(event.clientX, event.clientY);
            onMouseMove?.({ evt: event.nativeEvent, target: stageTarget });
          }}
          onMouseUp={(event) => {
            mockStageApi.setPointer(event.clientX, event.clientY);
            onMouseUp?.({ evt: event.nativeEvent, target: stageTarget });
          }}
          onTouchStart={(event) => {
            const touch = event.touches[0];
            if (touch) {
              mockStageApi.setPointer(touch.clientX, touch.clientY);
            }
            onTouchStart?.({ evt: event.nativeEvent, target: stageTarget });
          }}
          onTouchMove={(event) => {
            const touch = event.touches[0];
            if (touch) {
              mockStageApi.setPointer(touch.clientX, touch.clientY);
            }
            onTouchMove?.({ evt: event.nativeEvent, target: stageTarget });
          }}
          onTouchEnd={event => {
            onTouchEnd?.({ evt: event.nativeEvent });
          }}
        >
          {children}
        </div>
      );
    },
  );

  return {
    Stage: MockStage,
    Layer: MockNode,
    Group: MockNode,
    Rect: MockNode,
    Text: ({
      text,
      listening,
      scaleX,
      scaleY,
      ...props
    }: Record<string, unknown> & { text?: string }) => {
      void listening;
      void scaleX;
      void scaleY;
      return <div {...props}>{text}</div>;
    },
  };
});

async function renderGraphic(element: ReactElement) {
  const view = render(element);
  await screen.findByTestId('konva-stage');
  return view;
}

it.each(['light', 'dark'] as const)('keeps compact canvas tools and their active state available in the %s theme', mode => {
  const theme = createTheme({ palette: { mode, background: { paper: mode === 'light' ? '#fafafa' : '#121212' } } });
  const action = vi.fn();
  render(<ThemeProvider theme={theme}>
    <GraphicalCanvasTools width={375} height={600} fullscreen={false} onZoom={action} onFit={action}
      onFullscreen={action} onRotate={action} onPan={action} onTriggerChange={action} warnings={null}
      individualPlants={{ active: true, toggle: action }} />
  </ThemeProvider>);
  const toolbar = screen.getByTestId('graphical-canvas-tools');
  expect(toolbar).toHaveStyle({ backgroundColor: theme.palette.background.paper });
  fireEvent.click(screen.getByRole('button', { name: 'Weitere Grafikwerkzeuge' }));
  expect(screen.getByRole('menuitem', { name: 'Einzelpflanzen' })).toHaveAttribute('aria-description', 'Aktiv');
  expect(screen.getByRole('menuitem', { name: 'Ansicht um 90° nach rechts drehen' })).toBeVisible();
});

describe("GraphicalFields", async () => {
  const setViewportSize = (width: number, height: number): void => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: width,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: height,
    });
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
  };

  beforeEach(() => {
    setViewportSize(1280, 900);
    mockStageApi.setPointer(0, 0);
    mockStageApi.handlers = {};
    listByLocationMock.mockClear();
    listAreaPlansMock.mockReset().mockResolvedValue({ results: [] });
    saveByLocationMock.mockClear();
    Object.keys(mockKonvaNodes).forEach((key) => delete mockKonvaNodes[key]);
    mockUseHierarchyData.mockReturnValue({
      loading: false,
      error: null,
      locations: [{ id: 1, name: "Hof Nord" }],
      fields: [
        {
          id: 10,
          name: "Parzelle A",
          location: 1,
          area_sqm: 1200,
          width_m: 20,
          length_m: 40,
        },
      ],
      beds: [
        {
          id: 100,
          name: "Beet 1",
          field: 10,
          area_sqm: 80,
          width_m: 4,
          length_m: 10,
        },
      ],
    });
  });

  it('opens a non-modal bed preview from the keyboard and only navigates through Details', async () => {
    const onOpenDetails = vi.fn();
    await renderGraphic(<GraphicalFields onOpenDetails={onOpenDetails} />);
    const bed = await screen.findByRole('button', { name: 'Beet · Beet 1' });
    fireEvent.click(bed);
    expect(screen.getByRole('region', { name: 'Beet 1' })).toHaveFocus();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onOpenDetails).not.toHaveBeenCalled();
    expect(listAreaPlansMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Details anzeigen' }));
    expect(onOpenDetails).toHaveBeenCalledWith('bed', 100);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Beet 1' })).not.toBeInTheDocument();
    expect(bed).toHaveFocus();
  });

  it("keeps field world geometry identical between desktop and mobile viewport sizes", async () => {
    setViewportSize(1280, 900);
    const desktopRender = await renderGraphic(<GraphicalFields />);

    const desktopField = await screen.findByTestId("field-rect-10");
    const desktopGeometry = {
      x: screen.getByTestId("field-group-10").getAttribute("data-x"),
      y: desktopField.getAttribute("data-y"),
      width: desktopField.getAttribute("width"),
      height: desktopField.getAttribute("height"),
    };
    desktopRender.unmount();

    setViewportSize(375, 812);
    await renderGraphic(<GraphicalFields />);

    const mobileField = await screen.findByTestId("field-rect-10");
    const mobileGeometry = {
      x: screen.getByTestId("field-group-10").getAttribute("data-x"),
      y: mobileField.getAttribute("data-y"),
      width: mobileField.getAttribute("width"),
      height: mobileField.getAttribute("height"),
    };

    expect(mobileGeometry).toEqual(desktopGeometry);
  });

  it("defaults to horizontal lengths and restores the layout after four turns without saving", async () => {
    await renderGraphic(<GraphicalFields />);
    const field = await screen.findByTestId("field-rect-10");
    const bed = screen.getByTestId("bed-rect-100");
    expect(Number(field.getAttribute("width"))).toBeGreaterThan(Number(field.getAttribute("height")));
    expect(Number(bed.getAttribute("width"))).toBeGreaterThan(Number(bed.getAttribute("height")));
    const initial = mockKonvaNodes["bed-group-100"].getPosition();
    const originalWidth = bed.getAttribute("width");
    for (let i = 0; i < 4; i += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Ansicht um 90° nach rechts drehen" }));
      for (const label of screen.queryAllByTestId(/^bed-label-/)) expect(label).toHaveAttribute("rotation", "0");
    }
    expect(mockKonvaNodes["bed-group-100"].getPosition()).toEqual(initial);
    expect(screen.getByTestId("bed-rect-100")).toHaveAttribute("width", originalWidth);
    expect(saveByLocationMock).not.toHaveBeenCalled();
  });

  it.each([0, 90, 180, 270] as const)("saves field and bed drags in stored coordinates at %s degrees", async rotation => {
    listByLocationMock.mockResolvedValueOnce({ data: {
      field_layouts: [{ field: 10, location: 1, x: 1200, y: 800, version: 1 }],
      bed_layouts: [{ bed: 100, location: 1, x: 100, y: 100, version: 1 }],
    } });
    await renderGraphic(<GraphicalFields />);
    await waitFor(() => expect(mockKonvaNodes["field-group-10"].getPosition().y).toBe(1200));
    if (rotation === 0) fireEvent.click(screen.getByRole("button", { name: "Ansicht um 90° nach links drehen" }));
    for (let angle = 90; angle < rotation; angle += 90) {
      fireEvent.click(screen.getByRole("button", { name: "Ansicht um 90° nach rechts drehen" }));
    }
    fireEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    const drag = (id: string) => {
      const node = mockKonvaNodes[id];
      const start = node.getPosition();
      act(() => node.handlers.onDragEnd?.({
        evt: new Event("dragend"),
        target: createKonvaTarget({ current: { x: start.x + 30, y: start.y + 10 } }),
      }));
    };
    drag("field-group-10");
    const [dx, dy] = ({ 0: [30, 10], 90: [10, -30], 180: [-30, -10], 270: [-10, 30] })[rotation]!;
    await waitFor(() => expect(saveByLocationMock).toHaveBeenCalledWith(1, {
      field_layouts: [expect.objectContaining({ field: 10, x: 1200 + dx, y: 800 + dy })], bed_layouts: [],
    }));
    drag("bed-group-100");
    await waitFor(() => expect(saveByLocationMock.mock.calls.some(([, body]) => body.bed_layouts.length > 0)).toBe(true));
    const body = saveByLocationMock.mock.calls.findLast(([, body]) => body.bed_layouts.length > 0)![1];
    const saved = body.bed_layouts[0];
    const quarterTurn = rotation === 90 || rotation === 270;
    const surface = screen.getByTestId("field-usable-area-10");
    const width = Number(surface.getAttribute("width"));
    const height = Number(surface.getAttribute("height"));
    expect(width / height).toBeCloseTo(quarterTurn ? 2 : 0.5);
    const displayStoredWidth = quarterTurn ? height : width;
    const displayStoredHeight = quarterTurn ? width : height;
    // Persisted coordinates still use the original 340 × 676 layout surface.
    expect(saved.x).toBeCloseTo(100 + dx * 340 / displayStoredWidth);
    expect(saved.y).toBeCloseTo(100 + dy * 676 / displayStoredHeight);
  });

  it.each(['light', 'dark'] as const)("uses the same physical outline and %s theme surface in view mode", async mode => {
    const paper = mode === 'light' ? '#fafafa' : '#121212';
    const theme = createTheme({ palette: { mode, background: { paper } } });
    await renderGraphic(<ThemeProvider theme={theme}><GraphicalFields /></ThemeProvider>);

    const field = await screen.findByTestId("field-rect-10");
    const usable = screen.getByTestId("field-usable-area-10");
    const geometry = (element: HTMLElement) => ({
      x: Number(element.getAttribute("data-x")),
      y: Number(element.getAttribute("data-y")),
      width: Number(element.getAttribute("width")),
      height: Number(element.getAttribute("height")),
    });
    const fieldBox = geometry(field);
    expect(screen.queryByTestId("field-margin-10")).not.toBeInTheDocument();
    expect(geometry(usable)).toEqual(fieldBox);
    expect(fieldBox).toEqual({ x: 0, y: 0, width: 720, height: 360 });
    expect(usable).toHaveAttribute("fill", paper);
  });

  it('keeps a parcel name beside the site label when their screen bounds do not overlap', async () => {
    const data = mockUseHierarchyData();
    const field = { ...data.fields[0], length_m: 10, width_m: 10 };
    mockUseHierarchyData.mockReturnValue({ ...data, beds: [],
      locations: [{ ...data.locations[0], length_m: 70, width_m: 40 }],
      fields: [field, { ...field, id: 11, name: 'Parzelle B' }],
    });
    listByLocationMock.mockResolvedValueOnce({ data: {
      location_boundary: { x: 120, y: 120 }, bed_layouts: [],
      field_layouts: [{ field: 10, location: 1, x: 120, y: 1200 }, { field: 11, location: 1, x: 120, y: 650 }],
    } });
    await renderGraphic(<GraphicalFields interactionMode="edit" />);
    expect(await screen.findByTestId('field-label-11')).toBeInTheDocument();
    expect(screen.queryByTestId('field-label-10')).not.toBeInTheDocument();
  });

  it("moves the usable area along with a dragged field", async () => {
    await renderGraphic(<GraphicalFields />);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    });
    await screen.findByTestId("field-rect-10");
    const node = mockKonvaNodes["field-group-10"];
    const start = node.getPosition();
    const target = { current: { x: start.x + 40, y: start.y + 25 } };

    act(() => {
      node.handlers.onDragMove?.({ evt: new Event("drag"), target: createKonvaTarget(target) });
      node.handlers.onDragEnd?.({ evt: new Event("dragend"), target: createKonvaTarget(target) });
    });

    await waitFor(() => {
      const field = screen.getByTestId("field-rect-10");
      const usable = screen.getByTestId("field-usable-area-10");
      expect(mockKonvaNodes["field-group-10"].getPosition().x).not.toBe(start.x);
      expect(screen.getByTestId("field-group-10")).toContainElement(usable);
      expect(Number(usable.getAttribute("data-x"))).toBe(Number(field.getAttribute("data-x")));
      expect(Number(usable.getAttribute("data-y"))).toBe(Number(field.getAttribute("data-y")));
    });
  }, 15000);

  it("keeps beds at their local offsets during the drag and restores a rejected drop", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    let rejectSave!: (error: Error) => void;
    saveByLocationMock.mockImplementationOnce(() => new Promise((_, reject) => { rejectSave = reject; }));
    try {
      await renderGraphic(<GraphicalFields />);
      await screen.findByTestId("bed-rect-100");
      fireEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
      const node = mockKonvaNodes["field-group-10"];
      const from = node.getPosition();
      const bedOffset = mockKonvaNodes["bed-group-100"].getPosition();
      const target = { current: { ...from } };
      const drag = createKonvaTarget(target);
      for (const delta of [20, 40]) {
        target.current = { x: from.x + delta, y: from.y + delta };
        act(() => node.handlers.onDragMove?.({ evt: new Event("mousemove"), target: drag }));
        expect(target.current).not.toEqual(from);
        expect(mockKonvaNodes["bed-group-100"].getPosition()).toEqual(bedOffset);
        expect(screen.getByTestId("field-group-10")).toContainElement(screen.getByTestId("bed-rect-100"));
        expect(saveByLocationMock).not.toHaveBeenCalled();
      }
      act(() => node.handlers.onDragEnd?.({ evt: new Event("mouseup"), target: drag }));
      expect(mockKonvaNodes["field-group-10"].getPosition()).not.toEqual(from);
      expect(saveByLocationMock).toHaveBeenCalledTimes(1);
      expect(saveByLocationMock.mock.calls[0][1].bed_layouts).toEqual([]);

      await act(async () => rejectSave(new Error("Save rejected")));
      expect(mockKonvaNodes["field-group-10"].getPosition()).toEqual(from);
      expect(mockKonvaNodes["bed-group-100"].getPosition()).toEqual(bedOffset);
      expect(screen.getByText("Fehler beim Speichern der Parzelle")).toBeInTheDocument();
    } finally {
      log.mockRestore();
    }
  });

  it("handles cancellation and ignores a bed drag bubbling through its parcel", async () => {
    await renderGraphic(<GraphicalFields />);
    await screen.findByTestId("bed-rect-100");
    fireEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    const { getPosition, handlers } = mockKonvaNodes["field-group-10"];
    const from = getPosition();
    const target = { current: { x: from.x + 40, y: from.y + 25 } };
    const field = createKonvaTarget(target);
    const bed = createKonvaTarget({ current: { x: 10, y: 40 } });
    act(() => {
      handlers.onDragEnd?.({ evt: new Event("mouseup"), target: bed, currentTarget: field });
      handlers.onDragEnd?.({ evt: new Event("touchcancel"), target: field });
    });
    expect(target.current).toEqual(from);
    expect(saveByLocationMock).not.toHaveBeenCalled();
  });

  it("waits for a dropped parcel to save when returning to the graphic", async () => {
    let completeSave!: () => void;
    saveByLocationMock.mockImplementationOnce((_, data) => new Promise((resolve) => {
      completeSave = () => {
        listByLocationMock.mockResolvedValueOnce({ data });
        resolve({ data });
      };
    }));
    const firstView = await renderGraphic(<GraphicalFields />);
    await screen.findByTestId("field-group-10");
    fireEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    const node = mockKonvaNodes["field-group-10"];
    const from = node.getPosition();
    const target = createKonvaTarget({ current: { x: from.x + 40, y: from.y + 25 } });
    act(() => node.handlers.onDragEnd?.({ evt: new Event("mouseup"), target }));
    const dropped = node.getPosition();
    firstView.unmount();

    render(<GraphicalFields />);
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(listByLocationMock).toHaveBeenCalledTimes(1);
    await act(async () => completeSave());
    await screen.findByTestId("field-group-10");
    expect(mockKonvaNodes["field-group-10"].getPosition()).toEqual(dropped);
    expect(dropped).not.toEqual(from);
  });

  it("renders the edit mode toggle and allows toggling it by click", async () => {
    await renderGraphic(<GraphicalFields />);

    expect(await screen.findByRole("button", { name: "Bearbeiten" })).toBeInTheDocument();
    expect(
      screen.queryByText(
        LOCATION_EDIT_MODE_BANNER,
      ),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bearbeiten" })).toHaveAttribute("aria-pressed", "false");

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    });

    expect(screen.getByRole("button", { name: "Bearbeiten" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText(LOCATION_EDIT_MODE_BANNER)).not.toBeInTheDocument();
  }, 15000);

  it("renders fit-to-view and zoom controls", async () => {
    await renderGraphic(<GraphicalFields />);
    expect(await screen.findByRole("button", { name: "Bearbeiten" })).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Hineinzoomen" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Herauszoomen" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Alles einpassen" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Vollbild öffnen" }),
    ).toBeInTheDocument();
  }, 15000);

  it("supports viewport movement via pan buttons and arrow keys", async () => {
    await renderGraphic(<GraphicalFields />);

    const stage = screen.getByTestId("konva-stage");
    act(() => {
      Array.from({ length: 12 }).forEach(() => {
        fireEvent.click(screen.getByRole("button", { name: "Hineinzoomen" }));
      });
    });
    const startX = Number(stage.getAttribute("data-x"));
    const startY = Number(stage.getAttribute("data-y"));

    act(() => {
      fireEvent.click(
        screen.getByRole("button", { name: "Ansicht nach links verschieben" }),
      );
    });
    const afterPanLeftX = Number(
      screen.getByTestId("konva-stage").getAttribute("data-x"),
    );
    expect(afterPanLeftX).toBeGreaterThan(startX);

    act(() => {
      fireEvent.keyDown(window, { key: "ArrowRight" });
    });
    const afterArrowRightX = Number(
      screen.getByTestId("konva-stage").getAttribute("data-x"),
    );
    expect(afterArrowRightX).toBeLessThan(afterPanLeftX);

    act(() => {
      fireEvent.keyDown(window, { key: "ArrowUp" });
    });
    expect(Number(screen.getByTestId("konva-stage").getAttribute("data-y"))).toBeGreaterThan(startY);
  }, 15000);

  it("keeps dragging and the pressed state consistent with the edit mode toggle", async () => {
    await renderGraphic(<GraphicalFields />);

    expect(screen.getByRole("button", { name: "Bearbeiten" })).toHaveAttribute("aria-pressed", "false");
    expect(await screen.findByTestId("field-group-10")).toHaveAttribute(
      "draggable",
      "false",
    );
    expect(screen.getByTestId("field-group-10")).toHaveAttribute(
      "data-strict-mode",
      "false",
    );

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Bearbeiten" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByTestId("field-group-10")).toHaveAttribute(
        "draggable",
        "true",
      );
    });
    expect(screen.queryByText(LOCATION_EDIT_MODE_BANNER)).not.toBeInTheDocument();
  }, 15000);

  it("renders and edits only the selected location with the controlled topbar mode", async () => {
    const data = mockUseHierarchyData();
    mockUseHierarchyData.mockReturnValue({ ...data,
      locations: [...data.locations, { id: 2, name: 'Hof Süd' }],
      fields: [...data.fields, { ...data.fields[0], id: 20, name: 'Parzelle B', location: 2 }],
    });
    const view = await renderGraphic(<GraphicalFields showModeToggle={false} selectedLocationId={2} interactionMode="view" />);
    expect(await screen.findByTestId('field-group-20')).toHaveAttribute('draggable', 'false');
    expect(screen.queryByTestId('field-rect-10')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('konva-stage')).toHaveLength(1);
    expect(view.container.querySelector('.MuiAccordion-root')).toBeNull();
    view.rerender(<GraphicalFields showModeToggle={false} selectedLocationId={2} interactionMode="edit" />);
    expect(screen.getByTestId('field-group-20')).toHaveAttribute('draggable', 'true');
    expect(screen.queryByText(LOCATION_EDIT_MODE_BANNER)).not.toBeInTheDocument();
  });

  it("renders compact overlay zoom controls inside the graphic container", async () => {
    await renderGraphic(<GraphicalFields />);

    expect(screen.queryByText("Hineinzoomen")).not.toBeInTheDocument();
    expect(screen.queryByText("Herauszoomen")).not.toBeInTheDocument();
    expect(screen.queryByText("Alles einpassen")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hineinzoomen" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Herauszoomen" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Alles einpassen" }),
    ).toBeInTheDocument();
  }, 15000);

  it("allows viewport panning in view mode when dragging on empty canvas", async () => {
    await renderGraphic(<GraphicalFields />);

    act(() => {
      for (let i = 0; i < 12; i += 1) fireEvent.click(screen.getByRole("button", { name: "Hineinzoomen" }));
    });

    const stage = screen.getByTestId("konva-stage");
    const startX = Number(stage.getAttribute("data-x"));
    const startY = Number(stage.getAttribute("data-y"));
    expect(stage).toHaveAttribute("draggable", "false");

    act(() => {
      mockStageApi.setPointer(100, 120);
      mockStageApi.handlers.onMouseDown?.({
        evt: new MouseEvent("mousedown", { button: 0 }),
        target: {
          getStage() {
            return this;
          },
        },
      });
      mockStageApi.setPointer(165, 195);
      mockStageApi.handlers.onMouseMove?.({
        evt: new MouseEvent("mousemove", { button: 0 }),
        target: {
          getStage() {
            return this;
          },
        },
      });
      mockStageApi.handlers.onMouseUp?.({
        evt: new MouseEvent("mouseup", { button: 0 }),
        target: {
          getStage() {
            return this;
          },
        },
      });
    });

    const movedStage = screen.getByTestId("konva-stage");
    expect(Number(movedStage.getAttribute("data-x"))).toBeGreaterThanOrEqual(startX);
    expect(Number(movedStage.getAttribute("data-y"))).toBeGreaterThanOrEqual(startY);
  }, 15000);

  it("changes fit-to-view only on explicit trigger and keeps the viewport when switching modes", async () => {
    await renderGraphic(<GraphicalFields />);

    act(() => {
      for (let i = 0; i < 12; i += 1) fireEvent.click(screen.getByRole("button", { name: "Hineinzoomen" }));
    });

    const stage = screen.getByTestId("konva-stage");
    const initialX = Number(stage.getAttribute("data-x"));
    const initialY = Number(stage.getAttribute("data-y"));

    act(() => {
      mockStageApi.setPointer(40, 50);
      mockStageApi.handlers.onMouseDown?.({
        evt: new MouseEvent("mousedown", { button: 0 }),
        target: {
          getStage() {
            return this;
          },
        },
      });
      mockStageApi.setPointer(85, 105);
      mockStageApi.handlers.onMouseMove?.({
        evt: new MouseEvent("mousemove", { button: 0 }),
        target: {
          getStage() {
            return this;
          },
        },
      });
      mockStageApi.handlers.onMouseUp?.({
        evt: new MouseEvent("mouseup", { button: 0 }),
        target: {
          getStage() {
            return this;
          },
        },
      });
    });

    const movedStage = screen.getByTestId("konva-stage");
    const movedX = Number(movedStage.getAttribute("data-x"));
    const movedY = Number(movedStage.getAttribute("data-y"));
    expect(movedX).toBeGreaterThanOrEqual(initialX);
    expect(movedY).toBeGreaterThanOrEqual(initialY);

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
      fireEvent.click(screen.getByRole("button", { name: "Ansicht" }));
    });

    const modeToggledStage = screen.getByTestId("konva-stage");
    expect(Number(modeToggledStage.getAttribute("data-x"))).toBe(movedX);
    expect(Number(modeToggledStage.getAttribute("data-y"))).toBe(movedY);

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Alles einpassen" }));
    });

    const resetStage = screen.getByTestId("konva-stage");
    expect(Number.isFinite(Number(resetStage.getAttribute("data-x")))).toBe(true);
    expect(Number.isFinite(Number(resetStage.getAttribute("data-y")))).toBe(true);
  }, 15000);

  it("allows panning in edit mode when gesture starts on empty canvas and keeps object coordinates unchanged", async () => {
    await renderGraphic(<GraphicalFields />);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    });

    act(() => {
      for (let i = 0; i < 12; i += 1) fireEvent.click(screen.getByRole("button", { name: "Hineinzoomen" }));
    });

    const stage = screen.getByTestId("konva-stage");
    const startX = Number(stage.getAttribute("data-x"));
    const startY = Number(stage.getAttribute("data-y"));
    const fieldStartPosition = mockKonvaNodes["field-group-10"].getPosition();

    act(() => {
      mockStageApi.setPointer(120, 140);
      mockStageApi.handlers.onMouseDown?.({
        evt: new MouseEvent("mousedown", { button: 0 }),
        target: { getStage() { return this; } },
      });
      mockStageApi.setPointer(180, 210);
      mockStageApi.handlers.onMouseMove?.({
        evt: new MouseEvent("mousemove", { button: 0 }),
        target: { getStage() { return this; } },
      });
      mockStageApi.handlers.onMouseUp?.({
        evt: new MouseEvent("mouseup", { button: 0 }),
        target: { getStage() { return this; } },
      });
    });

    expect(Number(screen.getByTestId("konva-stage").getAttribute("data-x"))).toBeGreaterThanOrEqual(startX);
    expect(Number(screen.getByTestId("konva-stage").getAttribute("data-y"))).toBeGreaterThanOrEqual(startY);
    expect(mockKonvaNodes["field-group-10"].getPosition()).toEqual(fieldStartPosition);
  }, 15000);

  it("does not start panning in edit mode when pointer down starts on an interactive object", async () => {
    await renderGraphic(<GraphicalFields />);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    });

    const stage = screen.getByTestId("konva-stage");
    const startX = Number(stage.getAttribute("data-x"));
    const startY = Number(stage.getAttribute("data-y"));
    const stageObject = {};
    const nonStageTarget = { getStage: () => stageObject, hasName: () => false };

    act(() => {
      mockStageApi.setPointer(120, 140);
      mockStageApi.handlers.onMouseDown?.({
        evt: new MouseEvent("mousedown", { button: 0 }),
        target: nonStageTarget,
      });
      mockStageApi.setPointer(190, 240);
      mockStageApi.handlers.onMouseMove?.({
        evt: new MouseEvent("mousemove", { button: 0 }),
        target: nonStageTarget,
      });
      mockStageApi.handlers.onMouseUp?.({
        evt: new MouseEvent("mouseup", { button: 0 }),
        target: nonStageTarget,
      });
    });

    expect(Number(screen.getByTestId("konva-stage").getAttribute("data-x"))).toBe(startX);
    expect(Number(screen.getByTestId("konva-stage").getAttribute("data-y"))).toBe(startY);
  }, 15000);

  it("supports one-finger touch panning on empty canvas in edit mode", async () => {
    await renderGraphic(<GraphicalFields />);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    });

    act(() => {
      for (let i = 0; i < 12; i += 1) fireEvent.click(screen.getByRole("button", { name: "Hineinzoomen" }));
    });

    const stage = screen.getByTestId("konva-stage");
    const startX = Number(stage.getAttribute("data-x"));
    const startY = Number(stage.getAttribute("data-y"));
    const stageTarget = {
      getStage() {
        return this;
      },
    };

    act(() => {
      mockStageApi.setPointer(80, 100);
      mockStageApi.handlers.onTouchStart?.({
        evt: createTouchLikeEvent("touchstart", [{ clientX: 80, clientY: 100 }]),
        target: stageTarget,
      });
      mockStageApi.setPointer(140, 155);
      mockStageApi.handlers.onTouchMove?.({
        evt: createTouchLikeEvent("touchmove", [{ clientX: 140, clientY: 155 }]),
        target: stageTarget,
      });
      mockStageApi.handlers.onTouchEnd?.({ evt: createTouchLikeEvent("touchend", []) });
    });

    expect(Number(screen.getByTestId("konva-stage").getAttribute("data-x"))).toBeGreaterThanOrEqual(startX);
    expect(Number(screen.getByTestId("konva-stage").getAttribute("data-y"))).toBeGreaterThanOrEqual(startY);
  }, 15000);

  it("prevents object dragging in view mode and keeps the object position unchanged", async () => {
    await renderGraphic(<GraphicalFields />);

    const fieldRect = await screen.findByTestId("field-group-10");
    expect(fieldRect).toHaveAttribute("draggable", "false");

    const node = mockKonvaNodes["field-group-10"];
    const startPosition = node.getPosition();
    node.setPosition({ x: startPosition.x + 50, y: startPosition.y + 30 });

    act(() => {
      node.handlers.onDragMove?.({
        evt: new Event("drag"),
        target: createKonvaTarget({ current: node.getPosition() }),
      });
      node.handlers.onDragEnd?.({
        evt: new Event("dragend"),
        target: createKonvaTarget({ current: node.getPosition() }),
      });
    });

    expect(node.getPosition()).toEqual({
      x: startPosition.x + 50,
      y: startPosition.y + 30,
    });

    await waitFor(() => {
      expect(screen.getByTestId("field-group-10")).toHaveAttribute(
        "data-x",
        String(startPosition.x),
      );
      expect(screen.getByTestId("field-group-10")).toHaveAttribute(
        "data-y",
        String(startPosition.y),
      );
    });
  }, 15000);

  it("allows object dragging in edit mode and persists the updated position", async () => {
    await renderGraphic(<GraphicalFields />);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    });

    const fieldRect = await screen.findByTestId("field-group-10");
    expect(fieldRect).toHaveAttribute("draggable", "true");
    expect(fieldRect).toHaveAttribute("data-strict-mode", "false");

    const node = mockKonvaNodes["field-group-10"];
    const startPosition = node.getPosition();
    const dragTargetRef = {
      current: { x: startPosition.x + 40, y: startPosition.y + 25 },
    };

    act(() => {
      node.handlers.onDragMove?.({
        evt: new Event("drag"),
        target: createKonvaTarget(dragTargetRef),
      });
      node.handlers.onDragEnd?.({
        evt: new Event("dragend"),
        target: createKonvaTarget(dragTargetRef),
      });
    });

    await waitFor(() => {
      const moved = screen.getByTestId("field-group-10");
      expect(Number(moved.getAttribute("data-x"))).not.toBe(startPosition.x);
      expect(Number(moved.getAttribute("data-y"))).not.toBe(startPosition.y);
    });
  }, 15000);

  describe("location boundary", () => {
    // Field 10 is 20 × 40 m, i.e. 360 × 720 stored canvas units at 18 per metre.
    const FIELD_SIZE = { width: 360, height: 720 };
    const withLocationSize = (width_m: number, length_m: number) => {
      const data = mockUseHierarchyData();
      mockUseHierarchyData.mockReturnValue({
        ...data,
        locations: [{ id: 1, name: "Hof Nord", width_m, length_m }],
      });
    };
    const dragField = (dx: number, dy: number) => {
      const node = mockKonvaNodes["field-group-10"];
      const start = node.getPosition();
      const target = { current: { x: start.x + dx, y: start.y + dy } };
      act(() => {
        node.handlers.onDragMove?.({ evt: new Event("drag"), target: createKonvaTarget(target) });
        node.handlers.onDragEnd?.({ evt: new Event("dragend"), target: createKonvaTarget(target) });
      });
    };
    const lastSavedField = async (): Promise<FieldLayoutEntry> => {
      await waitFor(() =>
        expect(saveByLocationMock.mock.calls.some(([, body]) => body.field_layouts.length > 0)).toBe(true),
      );
      return saveByLocationMock.mock.calls.findLast(([, body]) => body.field_layouts.length > 0)![1].field_layouts[0];
    };
    const enterEditMode = () => fireEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));

    it.each([0, 90] as const)("keeps a dragged plot inside the fixed boundary at %s degrees", async (rotation) => {
      withLocationSize(30, 60);
      listByLocationMock.mockResolvedValueOnce({ data: {
        field_layouts: [{ field: 10, location: 1, x: 1100, y: 800, version: 1 }],
        bed_layouts: [{ bed: 100, location: 1, x: 40, y: 40, version: 1 }],
        location_boundary: { x: 1000, y: 700 },
      } });
      await renderGraphic(<GraphicalFields />);
      await screen.findByTestId("location-boundary-1");
      if (rotation === 0) fireEvent.click(screen.getByRole("button", { name: "Ansicht um 90° nach links drehen" }));
      const boundaryBefore = screen.getByTestId("location-boundary-1").outerHTML;
      enterEditMode();

      // Boundary 540 × 1080 at (1000, 700): x may run 1000..1180, y 700..1060.
      for (const [dx, dy] of [[5000, 5000], [-5000, -5000], [5000, -5000], [-5000, 5000]] as const) {
        saveByLocationMock.mockClear();
        dragField(dx, dy);
        const saved = await lastSavedField();
        expect([1000, 1180]).toContain(Math.round(saved.x));
        expect([700, 1060]).toContain(Math.round(saved.y));
      }
      // A saved origin is never re-sent and the boundary does not move.
      expect(saveByLocationMock.mock.calls.some(([, body]) => "location_boundary" in body)).toBe(false);
      expect(screen.getByTestId("location-boundary-1").outerHTML).toBe(boundaryBefore);
      expect(screen.queryByTestId("location-boundary-overflow-hint")).not.toBeInTheDocument();
    });

    it("moves the beds with their plot", async () => {
      withLocationSize(30, 60);
      listByLocationMock.mockResolvedValueOnce({ data: {
        field_layouts: [{ field: 10, location: 1, x: 1100, y: 800, version: 1 }],
        bed_layouts: [{ bed: 100, location: 1, x: 40, y: 40, version: 1 }],
        location_boundary: { x: 1000, y: 700 },
      } });
      await renderGraphic(<GraphicalFields />);
      await screen.findByTestId("location-boundary-1");
      const offset = () => mockKonvaNodes["bed-group-100"].getPosition();
      expect(screen.getByTestId("field-group-10")).toContainElement(screen.getByTestId("bed-rect-100"));
      const before = offset();
      enterEditMode();
      dragField(5000, 5000);
      await lastSavedField();
      await waitFor(() => expect(offset()).toEqual(before));
      expect(saveByLocationMock.mock.calls.every(([, body]) => body.bed_layouts.length === 0)).toBe(true);
    });

    it("fixes the boundary where it is drawn the first time a plot moves", async () => {
      withLocationSize(30, 60);
      listByLocationMock.mockResolvedValueOnce({ data: {
        field_layouts: [{ field: 10, location: 1, x: 1100, y: 800, version: 1 }],
        bed_layouts: [],
      } });
      await renderGraphic(<GraphicalFields />);
      await screen.findByTestId("location-boundary-1");
      enterEditMode();

      // Without a saved origin the boundary starts at the plot (1100, 800).
      dragField(5000, 5000);
      await waitFor(() => expect(saveByLocationMock).toHaveBeenCalledWith(1, {
        bed_layouts: [],
        field_layouts: [expect.objectContaining({ field: 10 })],
        location_boundary: { x: 1100, y: 800 },
      }));
      // At the default quarter turn view +x/+y is stored -y/+x; boundary 540 × 1080.
      const saved = await lastSavedField();
      expect([Math.round(saved.x), Math.round(saved.y)]).toEqual([1280, 800]);

      // The plot left the corner, yet the boundary stays put: it can reach x 1100 again.
      saveByLocationMock.mockClear();
      dragField(-5000, -5000);
      const back = await lastSavedField();
      expect([Math.round(back.x), Math.round(back.y)]).toEqual([1100, 1160]);
      expect(saveByLocationMock.mock.calls.some(([, body]) => "location_boundary" in body)).toBe(false);
    });

    it("flags but does not move a plot that lies outside, and pulls it in once dragged", async () => {
      withLocationSize(30, 60);
      listByLocationMock.mockResolvedValueOnce({ data: {
        field_layouts: [{ field: 10, location: 1, x: 3000, y: 3000, version: 1 }],
        bed_layouts: [],
        location_boundary: { x: 1000, y: 700 },
      } });
      await renderGraphic(<GraphicalFields />);
      const field = await screen.findByTestId("field-rect-10");
      expect(field).toHaveAttribute("data-outside-location", "true");
      expect(screen.getByTestId("location-boundary-overflow-hint")).toBeInTheDocument();
      expect(saveByLocationMock).not.toHaveBeenCalled();

      enterEditMode();
      dragField(1, 1);
      const saved = await lastSavedField();
      expect(saved.x).toBeGreaterThanOrEqual(1000);
      expect(saved.x + FIELD_SIZE.width).toBeLessThanOrEqual(1000 + 540);
      expect(saved.y).toBeGreaterThanOrEqual(700);
      expect(saved.y + FIELD_SIZE.height).toBeLessThanOrEqual(700 + 1080);
      await waitFor(() => expect(screen.queryByTestId("location-boundary-overflow-hint")).not.toBeInTheDocument());
    });

    it("lets a plot larger than the site slide only while it covers the site", async () => {
      // 10 m wide (180 units) is narrower than the 360-unit plot.
      withLocationSize(10, 60);
      listByLocationMock.mockResolvedValueOnce({ data: {
        field_layouts: [{ field: 10, location: 1, x: 1000, y: 800, version: 1 }],
        bed_layouts: [],
        location_boundary: { x: 1000, y: 700 },
      } });
      await renderGraphic(<GraphicalFields />);
      await screen.findByTestId("location-boundary-1");
      expect(screen.getByTestId("field-rect-10")).toHaveAttribute("data-outside-location", "true");
      fireEvent.click(screen.getByRole("button", { name: "Ansicht um 90° nach links drehen" }));
      enterEditMode();

      for (const dx of [5000, -5000]) {
        saveByLocationMock.mockClear();
        dragField(dx, 0);
        const saved = await lastSavedField();
        // Allowed x: 1000 + 180 - 360 = 820 up to 1000.
        expect([820, 1000]).toContain(Math.round(saved.x));
      }
      expect(screen.getByTestId("location-boundary-overflow-hint")).toBeInTheDocument();
    });

    it("keeps the free workspace when the location has no dimensions", async () => {
      listByLocationMock.mockResolvedValueOnce({ data: {
        field_layouts: [{ field: 10, location: 1, x: 1100, y: 800, version: 1 }],
        bed_layouts: [],
      } });
      await renderGraphic(<GraphicalFields />);
      await screen.findByTestId("field-rect-10");
      expect(screen.queryByTestId("location-boundary-1")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Ansicht um 90° nach links drehen" }));
      enterEditMode();
      dragField(3000, 2000);
      const saved = await lastSavedField();
      expect([Math.round(saved.x), Math.round(saved.y)]).toEqual([4100, 2800]);
      expect(saveByLocationMock.mock.calls.some(([, body]) => "location_boundary" in body)).toBe(false);
    });
  });

  it("supports large horizontal and vertical placement range without early boundary clipping", async () => {
    await renderGraphic(<GraphicalFields />);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    });

    const node = mockKonvaNodes["field-group-10"];
    const dragTargetRef = {
      current: { x: 10000, y: 120 },
    };

    act(() => {
      node.handlers.onDragEnd?.({
        evt: new Event("dragend"),
        target: createKonvaTarget(dragTargetRef),
      });
    });

    await waitFor(() => {
      const moved = screen.getByTestId("field-group-10");
      expect(Number(moved.getAttribute("data-x"))).toBeGreaterThan(9000);
      expect(Number(moved.getAttribute("data-y"))).toBeLessThan(1000);
    });
  }, 15000);

  it("persists layout changes only in edit mode", async () => {
    await renderGraphic(<GraphicalFields />);

    const viewNode = mockKonvaNodes["field-group-10"];
    act(() => {
      viewNode.handlers.onDragEnd?.({
        evt: new Event("dragend"),
        target: createKonvaTarget({
          current: {
            x: viewNode.getPosition().x + 25,
            y: viewNode.getPosition().y + 15,
          },
        }),
      });
    });

    await waitFor(() => {
      expect(saveByLocationMock).not.toHaveBeenCalled();
    });

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    });

    const editNode = mockKonvaNodes["field-group-10"];
    act(() => {
      editNode.handlers.onDragEnd?.({
        evt: new Event("dragend"),
        target: createKonvaTarget({
          current: {
            x: editNode.getPosition().x + 25,
            y: editNode.getPosition().y + 15,
          },
        }),
      });
    });

    await waitFor(() => {
      expect(saveByLocationMock).toHaveBeenCalledTimes(1);
    });
  }, 15000);

  it("stops active edit interactions cleanly when switching back to view mode", async () => {
    await renderGraphic(<GraphicalFields />);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    });

    const node = mockKonvaNodes["field-group-10"];
    const startPosition = node.getPosition();
    const dragTargetRef = {
      current: { x: startPosition.x + 35, y: startPosition.y + 20 },
    };

    act(() => {
      node.handlers.onDragMove?.({
        evt: new Event("drag"),
        target: createKonvaTarget(dragTargetRef),
      });
    });

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Ansicht" }));
    });

    await waitFor(() => {
      const resetNode = screen.getByTestId("field-group-10");
      expect(resetNode).toHaveAttribute("draggable", "false");
      expect(resetNode).toHaveAttribute("data-x", String(startPosition.x));
      expect(resetNode).toHaveAttribute("data-y", String(startPosition.y));
    });
  }, 15000);

  it("toggles edit mode via Alt+E but ignores the shortcut while typing in an input", async () => {
    await renderGraphic(<GraphicalFields />);
    await screen.findByRole("button", { name: "Bearbeiten" });
    expect(screen.getByRole("button", { name: "Bearbeiten" })).toHaveAttribute("aria-pressed", "false");

    act(() => {
      fireEvent.keyDown(window, { key: "e", altKey: true });
    });

    expect(screen.getByRole("button", { name: "Bearbeiten" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText(LOCATION_EDIT_MODE_BANNER)).not.toBeInTheDocument();

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    act(() => {
      fireEvent.keyDown(window, { key: "e", altKey: true });
    });

    expect(screen.getByRole("button", { name: "Bearbeiten" })).toHaveAttribute("aria-pressed", "true");

    input.blur();
    document.body.removeChild(input);
  }, 15000);
  it('retains each location camera and rotation across location and list/graphic switches', async () => {
    const data = mockUseHierarchyData();
    mockUseHierarchyData.mockReturnValue({ ...data,
      locations: [...data.locations, { id: 2, name: 'Hof Süd' }],
      fields: [...data.fields, { ...data.fields[0], id: 20, location: 2 }],
    });
    function Workspace() {
      const [selected, select] = useState(1);
      const [visible, show] = useState(true);
      const [camera, setCamera] = useState<GraphicalCameraState>({ viewports: {}, rotations: {} });
      return <>
        <button onClick={() => select(id => id === 1 ? 2 : 1)}>Switch location</button>
        <button onClick={() => show(value => !value)}>Switch representation</button>
        {visible ? <GraphicalFields selectedLocationId={selected} cameraState={camera} onCameraStateChange={setCamera} /> : null}
      </>;
    }
    render(<Workspace />);
    await screen.findByTestId('field-rect-10');
    fireEvent.click(screen.getByRole('button', { name: 'Ansicht um 90° nach rechts drehen' }));
    for (let index = 0; index < 10; index++) fireEvent.click(screen.getByRole('button', { name: 'Hineinzoomen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ansicht nach links verschieben' }));
    const camera = () => {
      const stage = screen.getByTestId('konva-stage');
      return ['data-scale-x', 'data-x', 'data-y'].map(attribute => stage.getAttribute(attribute));
    };
    const firstCamera = camera();
    const firstGeometry = screen.getByTestId('field-rect-10').getAttribute('width');
    fireEvent.click(screen.getByRole('button', { name: 'Switch location' }));
    await screen.findByTestId('field-rect-20');
    expect(screen.queryByTestId('field-rect-10')).not.toBeInTheDocument();
    expect(camera()).not.toEqual(firstCamera);
    fireEvent.click(screen.getByRole('button', { name: 'Switch location' }));
    await screen.findByTestId('field-rect-10');
    expect(camera()).toEqual(firstCamera);
    expect(screen.getByTestId('field-rect-10').getAttribute('width')).toBe(firstGeometry);
    fireEvent.click(screen.getByRole('button', { name: 'Switch representation' }));
    expect(screen.queryByTestId('konva-stage')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Switch representation' }));
    await screen.findByTestId('field-rect-10');
    expect(camera()).toEqual(firstCamera);
    expect(screen.getByTestId('field-rect-10').getAttribute('width')).toBe(firstGeometry);
    expect(saveByLocationMock).not.toHaveBeenCalled();
  });

  it('falls back to an available location when the selected location was removed', async () => {
    await renderGraphic(<GraphicalFields selectedLocationId={99} />);
    expect(await screen.findByTestId('field-rect-10')).toBeInTheDocument();
    expect(screen.getAllByTestId('konva-stage')).toHaveLength(1);
    expect(screen.getByRole('region', { name: 'Standort: Hof Nord' })).toBeInTheDocument();
    expect(saveByLocationMock).not.toHaveBeenCalled();
  });

  it('waits for saved layouts before showing a remembered camera', async () => {
    let release: (result: { data: LayoutData }) => void = () => {};
    const pending = new Promise<{ data: LayoutData }>(resolve => { release = resolve; });
    listByLocationMock.mockReturnValueOnce(pending);
    render(<GraphicalFields cameraState={{ viewports: { 1: { scale: 2, x: -100, y: -200 } }, rotations: {} }} />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.queryByTestId('konva-stage')).not.toBeInTheDocument();
    await act(async () => { release({ data: { bed_layouts: [], field_layouts: [] } }); });
    expect(await screen.findByTestId('konva-stage')).toHaveAttribute('data-scale-x', '2');
    expect(screen.getByTestId('konva-stage')).toHaveAttribute('data-x', '-100');
  });

  it('reports a failed layout fetch and retries without exposing an editable fallback layout', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      listByLocationMock.mockRejectedValueOnce(new Error('Temporary layout failure'));
      render(<GraphicalFields interactionMode="edit" />);
      expect(await screen.findByRole('alert')).toHaveTextContent('Die Grafik konnte nicht geladen werden. Versuche es erneut.');
      expect(screen.queryByTestId('konva-stage')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
      expect(await screen.findByTestId('konva-stage')).toBeInTheDocument();
      expect(listByLocationMock).toHaveBeenCalledTimes(2);
      expect(saveByLocationMock).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });

});
