import { FIELD_INNER_OFFSET_X, FIELD_INNER_OFFSET_Y, getFieldUsableArea } from '../pages/graphicalFieldsGeometry';
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GraphicalFields from "../pages/GraphicalFields";

const mockUseHierarchyData = vi.fn();
const { listByLocationMock, saveByLocationMock } = vi.hoisted(() => ({
  listByLocationMock: vi.fn(async () => ({
    data: { bed_layouts: [], field_layouts: [] },
  })),
  saveByLocationMock: vi.fn(async () => ({
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
    onTouchEnd?: () => void;
  },
  setPointer(x: number, y: number) {
    this.pointer = { x, y };
  },
};

const mockKonvaNodes: Record<
  string,
  {
    getPosition: () => { x: number; y: number };
    setPosition: (position: { x: number; y: number }) => void;
    handlers: {
      onDragMove?: (event: {
        evt: Event;
        target: {
          position: ({ x, y }: { x: number; y: number }) => void;
          x: () => number;
          y: () => number;
        };
      }) => void;
      onDragEnd?: (event: {
        evt: Event;
        target: {
          position: ({ x, y }: { x: number; y: number }) => void;
          x: () => number;
          y: () => number;
        };
      }) => void;
    };
  }
> = {};

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

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getLocationHeaderButton = (name = "Hof Nord"): HTMLElement =>
  screen.getByRole("button", {
    name: new RegExp(`^Standort: ${escapeRegExp(name)}(?:\\s+.*)?$`),
  });

const getLocationEditActionButton = (label = "Grafik bearbeiten"): HTMLElement =>
  screen.getAllByRole("button", { name: label })[0];

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
            onDragMove:
              onDragMove as (typeof mockKonvaNodes)[string]["handlers"]["onDragMove"],
            onDragEnd:
              onDragEnd as (typeof mockKonvaNodes)[string]["handlers"]["onDragEnd"],
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
          onTouchEnd={() => {
            onTouchEnd?.();
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

describe("GraphicalFields", () => {
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

  it("keeps field world geometry identical between desktop and mobile viewport sizes", async () => {
    setViewportSize(1280, 900);
    const desktopRender = render(<GraphicalFields />);
    act(() => {
      fireEvent.click(
        getLocationHeaderButton(),
      );
    });

    const desktopField = await screen.findByTestId("field-rect-10");
    const desktopGeometry = {
      x: desktopField.getAttribute("data-x"),
      y: desktopField.getAttribute("data-y"),
      width: desktopField.getAttribute("width"),
      height: desktopField.getAttribute("height"),
    };
    desktopRender.unmount();

    setViewportSize(375, 812);
    render(<GraphicalFields />);
    act(() => {
      fireEvent.click(
        getLocationHeaderButton(),
      );
    });

    const mobileField = await screen.findByTestId("field-rect-10");
    const mobileGeometry = {
      x: mobileField.getAttribute("data-x"),
      y: mobileField.getAttribute("data-y"),
      width: mobileField.getAttribute("width"),
      height: mobileField.getAttribute("height"),
    };

    expect(mobileGeometry).toEqual(desktopGeometry);
  });

  it("shades the margin beds cannot use and leaves the usable area white, also in view mode", async () => {
    render(<GraphicalFields />);
    act(() => {
      fireEvent.click(getLocationHeaderButton());
    });

    const field = await screen.findByTestId("field-rect-10");
    const margin = screen.getByTestId("field-margin-10");
    const usable = screen.getByTestId("field-usable-area-10");
    const geometry = (element: HTMLElement) => ({
      x: Number(element.getAttribute("data-x")),
      y: Number(element.getAttribute("data-y")),
      width: Number(element.getAttribute("width")),
      height: Number(element.getAttribute("height")),
    });
    const fieldBox = geometry(field);
    const area = getFieldUsableArea(fieldBox);

    expect(geometry(margin)).toEqual(fieldBox);
    expect(geometry(usable)).toEqual({
      x: fieldBox.x + area.x,
      y: fieldBox.y + area.y,
      width: area.width,
      height: area.height,
    });
    expect(margin).toHaveAttribute("fill", "#eeeeee");
    expect(usable).toHaveAttribute("fill", "#fff");
  });

  it("moves the usable area along with a dragged field", async () => {
    render(<GraphicalFields />);
    act(() => {
      fireEvent.click(getLocationHeaderButton());
      fireEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    });
    await screen.findByTestId("field-rect-10");
    const node = mockKonvaNodes["field-rect-10"];
    const start = node.getPosition();
    const target = { current: { x: start.x + 40, y: start.y + 25 } };

    act(() => {
      node.handlers.onDragMove?.({ evt: new Event("drag"), target: createKonvaTarget(target) });
      node.handlers.onDragEnd?.({ evt: new Event("dragend"), target: createKonvaTarget(target) });
    });

    await waitFor(() => {
      const field = screen.getByTestId("field-rect-10");
      const usable = screen.getByTestId("field-usable-area-10");
      expect(Number(field.getAttribute("data-x"))).not.toBe(start.x);
      expect(Number(usable.getAttribute("data-x"))).toBe(Number(field.getAttribute("data-x")) + FIELD_INNER_OFFSET_X);
      expect(Number(usable.getAttribute("data-y"))).toBe(Number(field.getAttribute("data-y")) + FIELD_INNER_OFFSET_Y);
    });
  }, 15000);

  it("renders the edit mode toggle and allows toggling it by click", async () => {
    render(<GraphicalFields />);

    expect(await screen.findByRole("button", { name: "Bearbeiten" })).toBeInTheDocument();
    expect(
      screen.queryByText(
        LOCATION_EDIT_MODE_BANNER,
      ),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bearbeiten" })).toHaveAttribute("aria-pressed", "false");

    act(() => {
      fireEvent.click(
        getLocationHeaderButton(),
      );
      fireEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    });

    expect(screen.getByRole("button", { name: "Bearbeiten" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("alert")).toHaveTextContent(LOCATION_EDIT_MODE_BANNER);
  }, 15000);

  it("renders fit-to-view and zoom controls", async () => {
    render(<GraphicalFields />);
    expect(await screen.findByRole("button", { name: "Bearbeiten" })).toBeInTheDocument();
    act(() => {
      fireEvent.click(
        getLocationHeaderButton(),
      );
    });

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
    render(<GraphicalFields />);
    act(() => {
      fireEvent.click(
        getLocationHeaderButton(),
      );
    });

    const stage = screen.getByTestId("konva-stage");
    act(() => {
      Array.from({ length: 6 }).forEach(() => {
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

  it("keeps UI hint and interaction state consistent with the edit mode toggle", async () => {
    render(<GraphicalFields />);
    act(() => {
      fireEvent.click(
        getLocationHeaderButton(),
      );
    });

    expect(screen.getByRole("button", { name: "Bearbeiten" })).toHaveAttribute("aria-pressed", "false");
    expect(await screen.findByTestId("field-rect-10")).toHaveAttribute(
      "draggable",
      "false",
    );
    expect(screen.getByTestId("field-rect-10")).toHaveAttribute(
      "data-strict-mode",
      "false",
    );

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Bearbeiten" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByTestId("field-rect-10")).toHaveAttribute(
        "draggable",
        "true",
      );
    });
    expect(screen.getByText(LOCATION_EDIT_MODE_BANNER)).toBeInTheDocument();
  }, 15000);

  it("scopes header edit actions to the selected location when the global mode toggle is hidden", async () => {
    mockUseHierarchyData.mockReturnValue({
      loading: false,
      error: null,
      locations: [
        { id: 1, name: "Hof Nord" },
        { id: 2, name: "Hof Süd" },
      ],
      fields: [
        {
          id: 10,
          name: "Parzelle A",
          location: 1,
          area_sqm: 1200,
          width_m: 20,
          length_m: 40,
        },
        {
          id: 20,
          name: "Parzelle B",
          location: 2,
          area_sqm: 900,
          width_m: 15,
          length_m: 30,
        },
      ],
      beds: [],
    });

    render(<GraphicalFields showModeToggle={false} />);

    expect(screen.queryByRole("button", { name: "Bearbeiten" })).not.toBeInTheDocument();

    act(() => {
      fireEvent.click(
        getLocationEditActionButton(),
      );
    });

    expect(screen.getByRole("alert")).toHaveTextContent(LOCATION_EDIT_MODE_BANNER);
    expect(screen.getByText("Grafikbearbeitung aktiv")).toBeInTheDocument();
    expect(await screen.findByTestId("field-rect-10")).toHaveAttribute(
      "draggable",
      "true",
    );
    expect(screen.getByTestId("field-rect-20")).toHaveAttribute(
      "draggable",
      "false",
    );
    expect(
      getLocationEditActionButton(
        "Grafikbearbeitung für Standort „Hof Nord“ beenden",
      ),
    ).toHaveAttribute("aria-pressed", "true");
  }, 15000);

  it("renders compact overlay zoom controls inside the graphic container", async () => {
    render(<GraphicalFields />);
    act(() => {
      fireEvent.click(
        getLocationHeaderButton(),
      );
    });

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

  it("allows viewport panning in view mode when dragging on empty canvas", () => {
    render(<GraphicalFields />);
    act(() => {
      fireEvent.click(
        getLocationHeaderButton(),
      );
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

  it("changes fit-to-view only on explicit trigger and keeps the viewport when switching modes", () => {
    render(<GraphicalFields />);
    act(() => {
      fireEvent.click(
        getLocationHeaderButton(),
      );
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
    render(<GraphicalFields />);
    act(() => {
      fireEvent.click(getLocationHeaderButton());
      fireEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    });

    const stage = screen.getByTestId("konva-stage");
    const startX = Number(stage.getAttribute("data-x"));
    const startY = Number(stage.getAttribute("data-y"));
    const fieldStartPosition = mockKonvaNodes["field-rect-10"].getPosition();

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
    expect(mockKonvaNodes["field-rect-10"].getPosition()).toEqual(fieldStartPosition);
  }, 15000);

  it("does not start panning in edit mode when pointer down starts on an interactive object", () => {
    render(<GraphicalFields />);
    act(() => {
      fireEvent.click(getLocationHeaderButton());
      fireEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    });

    const stage = screen.getByTestId("konva-stage");
    const startX = Number(stage.getAttribute("data-x"));
    const startY = Number(stage.getAttribute("data-y"));
    const stageObject = {};
    const nonStageTarget = { getStage: () => stageObject };

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

  it("supports one-finger touch panning on empty canvas in edit mode", () => {
    render(<GraphicalFields />);
    act(() => {
      fireEvent.click(getLocationHeaderButton());
      fireEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
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
      mockStageApi.handlers.onTouchEnd?.();
    });

    expect(Number(screen.getByTestId("konva-stage").getAttribute("data-x"))).toBeGreaterThanOrEqual(startX);
    expect(Number(screen.getByTestId("konva-stage").getAttribute("data-y"))).toBeGreaterThanOrEqual(startY);
  }, 15000);

  it("prevents object dragging in view mode and keeps the object position unchanged", async () => {
    render(<GraphicalFields />);
    act(() => {
      fireEvent.click(
        getLocationHeaderButton(),
      );
    });

    const fieldRect = await screen.findByTestId("field-rect-10");
    expect(fieldRect).toHaveAttribute("draggable", "false");

    const node = mockKonvaNodes["field-rect-10"];
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
      expect(screen.getByTestId("field-rect-10")).toHaveAttribute(
        "data-x",
        String(startPosition.x),
      );
      expect(screen.getByTestId("field-rect-10")).toHaveAttribute(
        "data-y",
        String(startPosition.y),
      );
    });
  }, 15000);

  it("allows object dragging in edit mode and persists the updated position", async () => {
    render(<GraphicalFields />);
    act(() => {
      fireEvent.click(
        getLocationHeaderButton(),
      );
      fireEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    });

    const fieldRect = await screen.findByTestId("field-rect-10");
    expect(fieldRect).toHaveAttribute("draggable", "true");
    expect(fieldRect).toHaveAttribute("data-strict-mode", "false");

    const node = mockKonvaNodes["field-rect-10"];
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
      const moved = screen.getByTestId("field-rect-10");
      expect(Number(moved.getAttribute("data-x"))).not.toBe(startPosition.x);
      expect(Number(moved.getAttribute("data-y"))).not.toBe(startPosition.y);
    });
  }, 15000);

  it("supports large horizontal and vertical placement range without early boundary clipping", async () => {
    render(<GraphicalFields />);
    act(() => {
      fireEvent.click(
        getLocationHeaderButton(),
      );
      fireEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    });

    const node = mockKonvaNodes["field-rect-10"];
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
      const moved = screen.getByTestId("field-rect-10");
      expect(Number(moved.getAttribute("data-x"))).toBeGreaterThan(9000);
      expect(Number(moved.getAttribute("data-y"))).toBeLessThan(1000);
    });
  }, 15000);

  it("persists layout changes only in edit mode", async () => {
    render(<GraphicalFields />);
    act(() => {
      fireEvent.click(
        getLocationHeaderButton(),
      );
    });

    const viewNode = mockKonvaNodes["field-rect-10"];
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

    const editNode = mockKonvaNodes["field-rect-10"];
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
    render(<GraphicalFields />);
    act(() => {
      fireEvent.click(
        getLocationHeaderButton(),
      );
      fireEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    });

    const node = mockKonvaNodes["field-rect-10"];
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
      const resetNode = screen.getByTestId("field-rect-10");
      expect(resetNode).toHaveAttribute("draggable", "false");
      expect(resetNode).toHaveAttribute("data-x", String(startPosition.x));
      expect(resetNode).toHaveAttribute("data-y", String(startPosition.y));
    });
  }, 15000);

  it("toggles edit mode via Alt+E but ignores the shortcut while typing in an input", async () => {
    render(<GraphicalFields />);
    await screen.findByRole("button", { name: "Bearbeiten" });
    expect(screen.getByRole("button", { name: "Bearbeiten" })).toHaveAttribute("aria-pressed", "false");

    act(() => {
      fireEvent.click(
        getLocationHeaderButton(),
      );
      fireEvent.keyDown(window, { key: "e", altKey: true });
    });

    expect(screen.getByRole("button", { name: "Bearbeiten" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("alert")).toHaveTextContent(LOCATION_EDIT_MODE_BANNER);

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
});
