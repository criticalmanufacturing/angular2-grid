import { Directive, ElementRef, Renderer2, EventEmitter, ComponentFactoryResolver, ComponentRef, KeyValueDiffer, KeyValueDiffers, OnInit, OnDestroy, DoCheck, Output, NgZone } from '@angular/core';
import { NgGridConfig, NgGridItemEvent, NgGridItemPosition, NgGridItemSize, NgGridRawPosition, NgGridItemDimensions, NgConfigFixDirection } from '../interfaces/INgGrid';
import { NgGridItem } from '../directives/NgGridItem';
import * as NgGridHelper from '../helpers/NgGridHelpers';
import { NgGridPlaceholder } from '../components/NgGridPlaceholder';
import { Subscription, Observable, fromEvent } from 'rxjs';

@Directive({
    selector: '[ngGrid]',
    inputs: ['config: ngGrid']
})
export class NgGrid implements OnInit, DoCheck, OnDestroy {
    public static CONST_DEFAULT_RESIZE_DIRECTIONS: string[] = [
        'bottomright',
        'bottomleft',
        'topright',
        'topleft',
        'right',
        'left',
        'bottom',
        'top',
    ];

    // Event Emitters
    @Output() public onDragStart: EventEmitter<NgGridItem> = new EventEmitter<NgGridItem>();
    @Output() public onDrag: EventEmitter<NgGridItem> = new EventEmitter<NgGridItem>();
    @Output() public onDragStop: EventEmitter<NgGridItem> = new EventEmitter<NgGridItem>();
    @Output() public onResizeStart: EventEmitter<NgGridItem> = new EventEmitter<NgGridItem>();
    @Output() public onResize: EventEmitter<NgGridItem> = new EventEmitter<NgGridItem>();
    @Output() public onResizeStop: EventEmitter<NgGridItem> = new EventEmitter<NgGridItem>();
    @Output() public onItemChange: EventEmitter<Array<NgGridItemEvent>> = new EventEmitter<Array<NgGridItemEvent>>();

    // Public variables
    public colWidth: number = 250;
    public rowHeight: number = 250;
    public minCols: number = 1;
    public minRows: number = 1;
    public marginTop: number = 10;
    public marginRight: number = 10;
    public marginBottom: number = 10;
    public marginLeft: number = 10;
    public screenMargin: number = 0;
    public isDragging: boolean = false;
    public isResizing: boolean = false;
    public autoStyle: boolean = true;
    public resizeEnable: boolean = true;
    public dragEnable: boolean = true;
    public cascade: string = 'up';
    public minWidth: number = 100;
    public minHeight: number = 100;
    public resizeDirections: string[] = NgGrid.CONST_DEFAULT_RESIZE_DIRECTIONS;

    // Private variables
    private _items: Map<string, NgGridItem> = new Map<string, NgGridItem>();
    private _draggingItem: NgGridItem | null = null;
    private _resizingItem: NgGridItem | null = null;
    private _resizeDirection: string | null = null;
    private _itemsInGrid: Set<string> = new Set<string>();
    private _maxCols: number = 0;
    private _maxRows: number = 0;
    private _visibleCols: number = 0;
    private _visibleRows: number = 0;
    private _posOffset: NgGridRawPosition | null = null;
    private _placeholderRef: ComponentRef<NgGridPlaceholder> | null = null;
    private _fixToGrid: boolean = false;
    private _autoResize: boolean = false;
    private _differ!: KeyValueDiffer<string, any>;
    private _destroyed: boolean = false;
    private _maintainRatio: boolean = false;
    private _aspectRatio!: number;
    private _preferNew: boolean = false;
    private _zoomOnDrag: boolean = false;
    private _limitToScreen: boolean = false;
    private _centerToScreen: boolean = false;
    private _curMaxRow: number = 0;
    private _curMaxCol: number = 0;
    private _dragReady: boolean = false;
    private _resizeReady: boolean = false;
    private _elementBasedDynamicRowHeight: boolean = false;
    private _itemFixDirection: NgConfigFixDirection = 'cascade';
    private _collisionFixDirection: NgConfigFixDirection = 'cascade';
    private _allowOverlap: boolean = false;
    private _cascadePromise!: Promise<void>;
    private _lastZValue: number = 1;

    // Events
    // Events

    private _documentMousemove$!: Observable<MouseEvent>;
    private _documentMouseup$!: Observable<MouseEvent>;
    private _mousedown$!: Observable<MouseEvent>;
    private _mousemove$!: Observable<MouseEvent>;
    private _mouseup$!: Observable<MouseEvent>;
    private _touchstart$!: Observable<TouchEvent>;
    private _touchmove$!: Observable<TouchEvent>;
    private _touchend$!: Observable<TouchEvent>;
    private _subscriptions: Subscription[] = [];

    private _enabledListener: boolean = false;

    // Default config
    private static CONST_DEFAULT_CONFIG: NgGridConfig = {
        margins: [10],
        draggable: true,
        resizable: true,
        max_cols: 0,
        max_rows: 0,
        visible_cols: 0,
        visible_rows: 0,
        col_width: 250,
        row_height: 250,
        cascade: 'up',
        min_width: 100,
        min_height: 100,
        fix_to_grid: false,
        auto_style: true,
        auto_resize: false,
        maintain_ratio: false,
        prefer_new: false,
        zoom_on_drag: false,
        limit_to_screen: false,
        center_to_screen: false,
        resize_directions: NgGrid.CONST_DEFAULT_RESIZE_DIRECTIONS,
        element_based_row_height: false,
        fix_item_position_direction: 'cascade',
        fix_collision_position_direction: 'cascade',
        allow_overlap: false,
    };
    private _config = NgGrid.CONST_DEFAULT_CONFIG;

    // [ng-grid] attribute handler
    set config(v: NgGridConfig) {
        if (v == null || typeof v !== 'object') {
            return;
        }

        this.setConfig(v);

        if (this._differ == null && v != null) {
            this._differ = this._differs.find(this._config).create();
        }

        this._differ.diff(this._config);
    }

    // Constructor
    constructor(
        private _differs: KeyValueDiffers,
        private _ngEl: ElementRef,
        private _renderer: Renderer2,
        private componentFactoryResolver: ComponentFactoryResolver,
        private _ngZone: NgZone
    ) {
        this._defineListeners();
    }

    // Public methods
    public ngOnInit(): void {
        this._renderer.addClass(this._ngEl.nativeElement, 'grid');
        if (this.autoStyle) this._renderer.setStyle(this._ngEl.nativeElement, 'position', 'relative');
        this.setConfig(this._config);
    }

    public ngOnDestroy(): void {
        this._destroyed = true;

        this._disableListeners();
    }

    public generateItemUid(): string {
        const uid: string = NgGridHelper.generateUuid();

        if (this._items.has(uid)) {
            return this.generateItemUid();
        }

        return uid;
    }

    public setConfig(config: NgGridConfig): void {
        this._config = config;

        var maxColRowChanged = false;
        for (var x in config) {
            var val = config[x];
            var intVal = !val ? 0 : parseInt(val);

            switch (x) {
                case 'margins':
                    this.setMargins(val);
                    break;
                case 'col_width':
                    this.colWidth = Math.max(intVal, 1);
                    break;
                case 'row_height':
                    this.rowHeight = Math.max(intVal, 1);
                    break;
                case 'auto_style':
                    this.autoStyle = val ? true : false;
                    break;
                case 'auto_resize':
                    this._autoResize = val ? true : false;
                    break;
                case 'draggable':
                    this.dragEnable = val ? true : false;
                    break;
                case 'resizable':
                    this.resizeEnable = val ? true : false;
                    break;
                case 'max_rows':
                    maxColRowChanged = maxColRowChanged || this._maxRows != intVal;
                    this._maxRows = intVal < 0 ? 0 : intVal;
                    break;
                case 'max_cols':
                    maxColRowChanged = maxColRowChanged || this._maxCols != intVal;
                    this._maxCols = intVal < 0 ? 0 : intVal;
                    break;
                case 'visible_rows':
                    this._visibleRows = Math.max(intVal, 0);
                    break;
                case 'visible_cols':
                    this._visibleCols = Math.max(intVal, 0);
                    break;
                case 'min_rows':
                    this.minRows = Math.max(intVal, 1);
                    break;
                case 'min_cols':
                    this.minCols = Math.max(intVal, 1);
                    break;
                case 'min_height':
                    this.minHeight = Math.max(intVal, 1);
                    break;
                case 'min_width':
                    this.minWidth = Math.max(intVal, 1);
                    break;
                case 'zoom_on_drag':
                    this._zoomOnDrag = val ? true : false;
                    break;
                case 'cascade':
                    if (this.cascade != val) {
                        this.cascade = val;
                        this._cascadeGrid();
                    }
                    break;
                case 'fix_to_grid':
                    this._fixToGrid = val ? true : false;
                    break;
                case 'maintain_ratio':
                    this._maintainRatio = val ? true : false;
                    break;
                case 'prefer_new':
                    this._preferNew = val ? true : false;
                    break;
                case 'limit_to_screen':
                    this._limitToScreen = !this._autoResize && !!val;
                    break;
                case 'center_to_screen':
                    this._centerToScreen = val ? true : false;
                    break;
                case 'resize_directions':
                    this.resizeDirections = val || ['bottomright', 'bottomleft', 'topright', 'topleft', 'right', 'left', 'bottom', 'top'];
                    break;
                case 'element_based_row_height':
                    this._elementBasedDynamicRowHeight = !!val;
                    break;
                case 'fix_item_position_direction':
                    this._itemFixDirection = val;
                    break;
                case 'fix_collision_position_direction':
                    this._collisionFixDirection = val;
                    break;
                case 'allow_overlap':
                    this._allowOverlap = !!val;
                    break;
            }
        }

        if (this._allowOverlap && this.cascade !== 'off' && this.cascade !== '') {
            console.warn('Unable to overlap items when a cascade direction is set.');
            this._allowOverlap = false;
        }

        if (this.dragEnable || this.resizeEnable) {
            this._enableListeners();
        } else {
            this._disableListeners();
        }

        if (this._itemFixDirection === 'cascade') {
            this._itemFixDirection = this._getFixDirectionFromCascade();
        }

        if (this._collisionFixDirection === 'cascade') {
            this._collisionFixDirection = this._getFixDirectionFromCascade();
        }

        if (this._limitToScreen) {
            const newMaxCols = this._getContainerColumns();

            if (this._maxCols != newMaxCols) {
                this._maxCols = newMaxCols;
                maxColRowChanged = true;
            }
        }

        if (this._limitToScreen && this._centerToScreen) {
            this.screenMargin = this._getScreenMargin();
        } else {
            this.screenMargin = 0;
        }

        if (this._maintainRatio) {
            if (this.colWidth && this.rowHeight) {
                this._aspectRatio = this.colWidth / this.rowHeight;
            } else {
                this._maintainRatio = false;
            }
        }

        if (maxColRowChanged) {
            if (this._maxCols > 0 && this._maxRows > 0) {    //    Can't have both, prioritise on cascade
                switch (this.cascade) {
                    case 'left':
                    case 'right':
                        this._maxCols = 0;
                        break;
                    case 'up':
                    case 'down':
                    default:
                        this._maxRows = 0;
                        break;
                }
            }

            this._updatePositionsAfterMaxChange();
        }

        this._calculateColWidth();
        this._calculateRowHeight();

        var maxWidth = this._maxCols * this.colWidth;
        var maxHeight = this._maxRows * this.rowHeight;

        if (maxWidth > 0 && this.minWidth > maxWidth) this.minWidth = 0.75 * this.colWidth;
        if (maxHeight > 0 && this.minHeight > maxHeight) this.minHeight = 0.75 * this.rowHeight;

        if (this.minWidth > this.colWidth) this.minCols = Math.max(this.minCols, Math.ceil(this.minWidth / this.colWidth));
        if (this.minHeight > this.rowHeight) this.minRows = Math.max(this.minRows, Math.ceil(this.minHeight / this.rowHeight));

        if (this._maxCols > 0 && this.minCols > this._maxCols) this.minCols = 1;
        if (this._maxRows > 0 && this.minRows > this._maxRows) this.minRows = 1;

        this._updateRatio();

        this._items.forEach((item: NgGridItem) => {
            this._removeFromGrid(item);
            item.setCascadeMode(this.cascade);
        });

        this._items.forEach((item: NgGridItem) => {
            item.recalculateSelf();
            this._addToGrid(item);
        });

        this._cascadeGrid();
        this._updateSize();
    }

    public getItemPosition(itemId: string): NgGridItemPosition {
        return this._items.has(itemId) ? this._items.get(itemId).getGridPosition() : null;
    }

    public getItemSize(itemId: string): NgGridItemSize {
        return this._items.has(itemId) ? this._items.get(itemId).getSize() : null;
    }

    public ngDoCheck(): boolean {
        if (this._differ != null) {
            var changes = this._differ.diff(this._config);

            if (changes != null) {
                this._applyChanges(changes);

                return true;
            }
        }

        return false;
    }

    public setMargins(margins: Array<string>): void {
        this.marginTop = Math.max(parseInt(margins[0]), 0);
        this.marginRight = margins.length >= 2 ? Math.max(parseInt(margins[1]), 0) : this.marginTop;
        this.marginBottom = margins.length >= 3 ? Math.max(parseInt(margins[2]), 0) : this.marginTop;
        this.marginLeft = margins.length >= 4 ? Math.max(parseInt(margins[3]), 0) : this.marginRight;
    }

    public enableDrag(): void {
        this.dragEnable = true;
    }

    public disableDrag(): void {
        this.dragEnable = false;
    }

    public enableResize(): void {
        this.resizeEnable = true;
    }

    public disableResize(): void {
        this.resizeEnable = false;
    }

    public addItem(ngItem: NgGridItem): void {
        ngItem.setCascadeMode(this.cascade);

        if (!this._preferNew) {
            var newPos = this._fixGridPosition(ngItem.getGridPosition(), ngItem.getSize());
            ngItem.setGridPosition(newPos);
        }

        if (ngItem.uid === null || this._items.has(ngItem.uid)) {
            ngItem.uid = this.generateItemUid();
        }

        this._items.set(ngItem.uid, ngItem);
        this._addToGrid(ngItem);

        this._updateSize();

        this.triggerCascade().then(() => {
            ngItem.recalculateSelf();
            ngItem.onCascadeEvent();

            this._emitOnItemChange();
        });

    }

    public removeItem(ngItem: NgGridItem): void {
        this._removeFromGrid(ngItem);

        this._items.delete(ngItem.uid);

        if (this._destroyed) return;

        this.triggerCascade().then(() => {
            this._updateSize();
            this._items.forEach((item: NgGridItem) => item.recalculateSelf());
            this._emitOnItemChange();
        });
    }

    public updateItem(ngItem: NgGridItem): void {
        this._removeFromGrid(ngItem);
        this._addToGrid(ngItem);

        this.triggerCascade().then(() => {
            this._updateSize();
            ngItem.onCascadeEvent();
        });
    }

    public triggerCascade(): Promise<void> {
        if (!this._cascadePromise) {
            this._cascadePromise = new Promise<void>((resolve: () => void) => {
                setTimeout(() => {
                    this._cascadePromise = null;
                    this._cascadeGrid(null, null);
                    resolve();
                }, 0);
            });
        }

        return this._cascadePromise;
    }

    public triggerResize(): void {
        this.resizeEventHandler(null);
    }

    public resizeEventHandler = (e: any): void => {
        this._calculateColWidth();
        this._calculateRowHeight();

        this._updateRatio();

        if (this._limitToScreen) {
            const newMaxColumns = this._getContainerColumns();
            if (this._maxCols !== newMaxColumns) {
                this._maxCols = newMaxColumns;
                this._updatePositionsAfterMaxChange();
                this._cascadeGrid();
            }

            if (this._centerToScreen) {
                this.screenMargin = this._getScreenMargin();

                this._items.forEach((item: NgGridItem) => {
                    item.recalculateSelf();
                });
            }
        } else if (this._autoResize) {
            this._items.forEach((item: NgGridItem) => {
                item.recalculateSelf();
            });
        }

        this._updateSize();
    }

    public mouseDownEventHandler = (e: MouseEvent | TouchEvent): void => {
        var mousePos = this._getMousePosition(e);
        var item = this._getItemFromPosition(mousePos);

        if (item == null) return;

        const resizeDirection: string = item.canResize(e);

        if (this.resizeEnable && resizeDirection) {
            this._resizeReady = true;
            this._resizingItem = item;
            this._resizeDirection = resizeDirection;

            e.preventDefault();
        } else if (this.dragEnable && item.canDrag(e)) {
            this._dragReady = true;
            this._draggingItem = item;

            const itemPos = item.getPosition();
            this._posOffset = { 'left': (mousePos.left - itemPos.left), 'top': (mousePos.top - itemPos.top) }

            e.preventDefault();
        }
    }

    public mouseUpEventHandler = (e: MouseEvent | TouchEvent): void => {
        if (this.isDragging) {
            this._dragStop(e);
        } else if (this.isResizing) {
            this._resizeStop(e);
        } else if (this._dragReady || this._resizeReady) {
            this._cleanDrag();
            this._cleanResize();
        }
    }

    public mouseMoveEventHandler = (e: MouseEvent | TouchEvent): void => {
        if (this._resizeReady) {
            this._resizeStart(e);
            e.preventDefault();
            return;
        } else if (this._dragReady) {
            this._dragStart(e);
            e.preventDefault();
            return;
        }

        if (this.isDragging) {
            this._drag(e);
        } else if (this.isResizing) {
            this._resize(e);
        } else {
            var mousePos = this._getMousePosition(e);
            var item = this._getItemFromPosition(mousePos);

            if (item) {
                item.onMouseMove(e);
            }
        }
    }

    //    Private methods
    private _getFixDirectionFromCascade(): NgConfigFixDirection {
        switch (this.cascade) {
            case 'up':
            case 'down':
            default:
                return 'vertical';
            case 'left':
            case 'right':
                return 'horizontal';
        }
    }
    private _updatePositionsAfterMaxChange(): void {
        this._items.forEach((item: NgGridItem) => {
            var pos = item.getGridPosition();
            var dims = item.getSize();

            if (!this._hasGridCollision(pos, dims) && this._isWithinBounds(pos, dims) && dims.x <= this._maxCols && dims.y <= this._maxRows) {
                return;
            }

            this._removeFromGrid(item);

            if (this._maxCols > 0 && dims.x > this._maxCols) {
                dims.x = this._maxCols;
                item.setSize(dims);
            } else if (this._maxRows > 0 && dims.y > this._maxRows) {
                dims.y = this._maxRows;
                item.setSize(dims);
            }

            if (this._hasGridCollision(pos, dims) || !this._isWithinBounds(pos, dims, true)) {
                var newPosition = this._fixGridPosition(pos, dims);
                item.setGridPosition(newPosition);
            }

            this._addToGrid(item);
        });
    }

    private _calculateColWidth(): void {
        if (this._autoResize) {
            if (this._maxCols > 0 || this._visibleCols > 0) {
                var maxCols = this._maxCols > 0 ? this._maxCols : this._visibleCols;
                var maxWidth: number = this._ngEl.nativeElement.offsetWidth;

                var colWidth: number = Math.floor(maxWidth / maxCols);
                colWidth -= (this.marginLeft + this.marginRight);
                if (colWidth > 0) this.colWidth = colWidth;

            }
        }

        if (this.colWidth < this.minWidth || this.minCols > this._config.min_cols) {
            this.minCols = Math.max(this._config.min_cols, Math.ceil(this.minWidth / this.colWidth));
        }
    }

    private _calculateRowHeight(): void {
        if (this._autoResize) {
            if (this._maxRows > 0 || this._visibleRows > 0) {
                var maxRows = this._maxRows > 0 ? this._maxRows : this._visibleRows;
                let maxHeight: number;

                if (this._elementBasedDynamicRowHeight) {
                    maxHeight = this._ngEl.nativeElement.getBoundingClientRect().height;
                } else {
                    maxHeight = this._ngEl.nativeElement.offsetHeight - this.marginTop - this.marginBottom;
                }

                var rowHeight: number = Math.max(Math.floor(maxHeight / maxRows), this.minHeight);
                rowHeight -= (this.marginTop + this.marginBottom);
                if (rowHeight > 0) this.rowHeight = rowHeight;

            }
        }

        if (this.rowHeight < this.minHeight || this.minRows > this._config.min_rows) {
            this.minRows = Math.max(this._config.min_rows, Math.ceil(this.minHeight / this.rowHeight));
        }
    }

    private _updateRatio(): void {
        if (!this._autoResize || !this._maintainRatio) return;

        if (this._maxCols > 0 && this._visibleRows <= 0) {
            this.rowHeight = this.colWidth / this._aspectRatio;
        } else if (this._maxRows > 0 && this._visibleCols <= 0) {
            this.colWidth = this._aspectRatio * this.rowHeight;
        } else if (this._maxCols == 0 && this._maxRows == 0) {
            if (this._visibleCols > 0) {
                this.rowHeight = this.colWidth / this._aspectRatio;
            } else if (this._visibleRows > 0) {
                this.colWidth = this._aspectRatio * this.rowHeight;
            }
        }
    }

    private _applyChanges(changes: any): void {
        changes.forEachAddedItem((record: any) => { this._config[record.key] = record.currentValue; });
        changes.forEachChangedItem((record: any) => { this._config[record.key] = record.currentValue; });
        changes.forEachRemovedItem((record: any) => { delete this._config[record.key]; });

        this.setConfig(this._config);
    }

    private _resizeStart(e: any): void {
        if (!this.resizeEnable || !this._resizingItem) return;

        //    Setup
        this._resizingItem.startMoving();
        this._removeFromGrid(this._resizingItem);
        this._createPlaceholder(this._resizingItem);

        if (this._allowOverlap) {
            this._resizingItem.zIndex = this._lastZValue++;
        }

        //    Status Flags
        this.isResizing = true;
        this._resizeReady = false;

        //    Events
        this.onResizeStart.emit(this._resizingItem);
        this._resizingItem.onResizeStartEvent();
    }

    private _dragStart(e: any): void {
        if (!this.dragEnable || !this._draggingItem) return;

        //    Start dragging
        this._draggingItem.startMoving();
        this._removeFromGrid(this._draggingItem);
        this._createPlaceholder(this._draggingItem);

        if (this._allowOverlap) {
            this._draggingItem.zIndex = this._lastZValue++;
        }

        //    Status Flags
        this.isDragging = true;
        this._dragReady = false;

        //    Events
        this.onDragStart.emit(this._draggingItem);
        this._draggingItem.onDragStartEvent();

        //    Zoom
        if (this._zoomOnDrag) {
            this._zoomOut();
        }
    }

    private _zoomOut(): void {
        this._renderer.setStyle(this._ngEl.nativeElement, 'transform', 'scale(0.5, 0.5)');
    }

    private _resetZoom(): void {
        this._renderer.setStyle(this._ngEl.nativeElement, 'transform', '');
    }

    private _drag(e: any): void {
        if (!this.isDragging) return;

        if (window.getSelection) {
            if (window.getSelection().empty) {
                window.getSelection().empty();
            } else if (window.getSelection().removeAllRanges) {
                window.getSelection().removeAllRanges();
            }
        } else if ((<any>document).selection) {
            (<any>document).selection.empty();
        }

        var mousePos = this._getMousePosition(e);
        var newL = (mousePos.left - this._posOffset.left);
        var newT = (mousePos.top - this._posOffset.top);

        var itemPos = this._draggingItem.getGridPosition();
        var gridPos = this._calculateGridPosition(newL, newT);
        var dims = this._draggingItem.getSize();

        gridPos = this._fixPosToBoundsX(gridPos, dims);

        if (!this._isWithinBoundsY(gridPos, dims)) {
            gridPos = this._fixPosToBoundsY(gridPos, dims);
        }

        if (gridPos.col != itemPos.col || gridPos.row != itemPos.row) {
            this._draggingItem.setGridPosition(gridPos, this._fixToGrid);
            this._placeholderRef.instance.setGridPosition(gridPos);

            if (['up', 'down', 'left', 'right'].indexOf(this.cascade) >= 0) {
                this._fixGridCollisions(gridPos, dims);
                this._cascadeGrid(gridPos, dims);
            }
        }

        if (!this._fixToGrid) {
            this._draggingItem.setPosition(newL, newT);
        }

        this.onDrag.emit(this._draggingItem);
        this._draggingItem.onDragEvent();
    }

    private _resize(e: any): void {
        if (!this.isResizing) { return; }

        if (window.getSelection) {
            if (window.getSelection().empty) {
                window.getSelection().empty();
            } else if (window.getSelection().removeAllRanges) {
                window.getSelection().removeAllRanges();
            }
        } else if ((<any>document).selection) {
            (<any>document).selection.empty();
        }

        const mousePos = this._getMousePosition(e);
        const itemPos = this._resizingItem.getPosition();
        const itemDims = this._resizingItem.getDimensions();
        const endCorner = {
            left: itemPos.left + itemDims.width,
            top: itemPos.top + itemDims.height,
        }

        const resizeTop = this._resizeDirection.includes('top');
        const resizeBottom = this._resizeDirection.includes('bottom');
        const resizeLeft = this._resizeDirection.includes('left')
        const resizeRight = this._resizeDirection.includes('right');

        // Calculate new width and height based upon resize direction
        let newW = resizeRight
            ? (mousePos.left - itemPos.left + 1)
            : resizeLeft
                ? (endCorner.left - mousePos.left + 1)
                : itemDims.width;
        let newH = resizeBottom
            ? (mousePos.top - itemPos.top + 1)
            : resizeTop
                ? (endCorner.top - mousePos.top + 1)
                : itemDims.height;

        if (newW < this.minWidth)
            newW = this.minWidth;
        if (newH < this.minHeight)
            newH = this.minHeight;
        if (newW < this._resizingItem.minWidth)
            newW = this._resizingItem.minWidth;
        if (newH < this._resizingItem.minHeight)
            newH = this._resizingItem.minHeight;

        let newX = itemPos.left;
        let newY = itemPos.top;

        if (resizeLeft)
            newX = endCorner.left - newW;
        if (resizeTop)
            newY = endCorner.top - newH;

        let calcSize = this._calculateGridSize(newW, newH);
        const itemSize = this._resizingItem.getSize();
        const iGridPos = this._resizingItem.getGridPosition();
        const bottomRightCorner = {
            col: iGridPos.col + itemSize.x,
            row: iGridPos.row + itemSize.y,
        };
        const targetPos: NgGridItemPosition = Object.assign({}, iGridPos);

        if (this._resizeDirection.includes('top'))
            targetPos.row = bottomRightCorner.row - calcSize.y;
        if (this._resizeDirection.includes('left'))
            targetPos.col = bottomRightCorner.col - calcSize.x;

        if (!this._isWithinBoundsX(targetPos, calcSize))
            calcSize = this._fixSizeToBoundsX(targetPos, calcSize);

        if (!this._isWithinBoundsY(targetPos, calcSize))
            calcSize = this._fixSizeToBoundsY(targetPos, calcSize);

        calcSize = this._resizingItem.fixResize(calcSize);

        if (calcSize.x != itemSize.x || calcSize.y != itemSize.y) {
            this._resizingItem.setGridPosition(targetPos, this._fixToGrid);
            this._placeholderRef.instance.setGridPosition(targetPos);
            this._resizingItem.setSize(calcSize, this._fixToGrid);
            this._placeholderRef.instance.setSize(calcSize);

            if (['up', 'down', 'left', 'right'].indexOf(this.cascade) >= 0) {
                this._fixGridCollisions(targetPos, calcSize);
                this._cascadeGrid(targetPos, calcSize);
            }
        }

        if (!this._fixToGrid) {
            this._resizingItem.setDimensions(newW, newH);
            this._resizingItem.setPosition(newX, newY);
        }

        this.onResize.emit(this._resizingItem);
        this._resizingItem.onResizeEvent();
    }

    private _dragStop(e: any): void {
        if (!this.isDragging) return;

        this.isDragging = false;

        var itemPos = this._draggingItem.getGridPosition();

        this._draggingItem.setGridPosition(itemPos);
        this._addToGrid(this._draggingItem);

        this._cascadeGrid();
        this._updateSize();

        this._draggingItem.stopMoving();
        this._draggingItem.onDragStopEvent();
        this.onDragStop.emit(this._draggingItem);

        this._cleanDrag();
        this._placeholderRef.destroy();

        this._emitOnItemChange();

        if (this._zoomOnDrag) {
            this._resetZoom();
        }
    }

    private _resizeStop(e: any): void {
        if (!this.isResizing) return;

        this.isResizing = false;

        const itemDims = this._resizingItem.getSize();
        this._resizingItem.setSize(itemDims);

        const itemPos = this._resizingItem.getGridPosition();
        this._resizingItem.setGridPosition(itemPos);

        this._addToGrid(this._resizingItem);

        this._cascadeGrid();
        this._updateSize();

        this._resizingItem.stopMoving();
        this._resizingItem.onResizeStopEvent();
        this.onResizeStop.emit(this._resizingItem);

        this._cleanResize();
        this._placeholderRef.destroy();

        this._emitOnItemChange();
    }

    private _cleanDrag(): void {
        this._draggingItem = null;
        this._posOffset = null;
        this.isDragging = false;
        this._dragReady = false;
    }

    private _cleanResize(): void {
        this._resizingItem = null;
        this._resizeDirection = null;
        this.isResizing = false;
        this._resizeReady = false;
    }

    private _calculateGridSize(width: number, height: number): NgGridItemSize {
        width += this.marginLeft + this.marginRight;
        height += this.marginTop + this.marginBottom;

        var sizex = Math.max(this.minCols, Math.round(width / (this.colWidth + this.marginLeft + this.marginRight)));
        var sizey = Math.max(this.minRows, Math.round(height / (this.rowHeight + this.marginTop + this.marginBottom)));

        if (!this._isWithinBoundsX({ col: 1, row: 1 }, { x: sizex, y: sizey })) sizex = this._maxCols;
        if (!this._isWithinBoundsY({ col: 1, row: 1 }, { x: sizex, y: sizey })) sizey = this._maxRows;

        return { 'x': sizex, 'y': sizey };
    }

    private _calculateGridPosition(left: number, top: number): NgGridItemPosition {
        var col = Math.max(1, Math.round(left / (this.colWidth + this.marginLeft + this.marginRight)) + 1);
        var row = Math.max(1, Math.round(top / (this.rowHeight + this.marginTop + this.marginBottom)) + 1);

        if (!this._isWithinBoundsX({ col: col, row: row }, { x: 1, y: 1 })) col = this._maxCols;
        if (!this._isWithinBoundsY({ col: col, row: row }, { x: 1, y: 1 })) row = this._maxRows;

        return { 'col': col, 'row': row };
    }

    private _hasGridCollision(pos: NgGridItemPosition, dims: NgGridItemSize): boolean {
        var positions = this._getCollisions(pos, dims);

        if (positions == null || positions.length == 0) return false;

        return positions.some((v: NgGridItem) => {
            return !(v === null);
        });
    }

    private _getCollisions(pos: NgGridItemPosition, dims: NgGridItemSize): Array<NgGridItem> {
        if (this._allowOverlap) return [];

        const returns: Array<NgGridItem> = [];

        if (!pos.col) { pos.col = 1; }
        if (!pos.row) { pos.row = 1; }

        const leftCol = pos.col;
        const rightCol = pos.col + dims.x;
        const topRow = pos.row;
        const bottomRow = pos.row + dims.y;

        this._itemsInGrid.forEach((itemId: string) => {
            const item: NgGridItem = this._items.get(itemId);

            if (!item) {
                this._itemsInGrid.delete(itemId);
                return;
            }

            const itemLeftCol = item.col;
            const itemRightCol = item.col + item.sizex;
            const itemTopRow = item.row;
            const itemBottomRow = item.row + item.sizey;

            const withinColumns = leftCol < itemRightCol && itemLeftCol < rightCol;
            const withinRows = topRow < itemBottomRow && itemTopRow < bottomRow;

            if (withinColumns && withinRows) {
                returns.push(item);
            }
        });

        return returns;
    }

    private _fixGridCollisions(pos: NgGridItemPosition, dims: NgGridItemSize): void {
        const collisions: Array<NgGridItem> = this._getCollisions(pos, dims);
        if (collisions.length === 0) { return; }

        for (let collision of collisions) {
            this._removeFromGrid(collision);

            const itemDims: NgGridItemSize = collision.getSize();
            const itemPos: NgGridItemPosition = collision.getGridPosition();
            let newItemPos: NgGridItemPosition = { col: itemPos.col, row: itemPos.row };

            if (this._collisionFixDirection === 'vertical') {
                newItemPos.row = pos.row + dims.y;

                if (!this._isWithinBoundsY(newItemPos, itemDims)) {
                    newItemPos.col = pos.col + dims.x;
                    newItemPos.row = 1;
                }
            } else if (this._collisionFixDirection === 'horizontal') {
                newItemPos.col = pos.col + dims.x;

                if (!this._isWithinBoundsX(newItemPos, itemDims)) {
                    newItemPos.col = 1;
                    newItemPos.row = pos.row + dims.y;
                }
            }

            collision.setGridPosition(newItemPos);

            this._fixGridCollisions(newItemPos, itemDims);
            this._addToGrid(collision);
            collision.onCascadeEvent();
        }

        this._fixGridCollisions(pos, dims);
    }

    private _cascadeGrid(pos?: NgGridItemPosition, dims?: NgGridItemSize): void {
        if (this._destroyed) return;
        if (this._allowOverlap) return;
        if (!pos !== !dims) throw new Error('Cannot cascade with only position and not dimensions');

        if (this.isDragging && this._draggingItem && !pos && !dims) {
            pos = this._draggingItem.getGridPosition();
            dims = this._draggingItem.getSize();
        } else if (this.isResizing && this._resizingItem && !pos && !dims) {
            pos = this._resizingItem.getGridPosition();
            dims = this._resizingItem.getSize();
        }

        let itemsInGrid: NgGridItem[] = Array.from(this._itemsInGrid, (itemId: string) => this._items.get(itemId));

        switch (this.cascade) {
            case 'up':
            case 'down':
                itemsInGrid = itemsInGrid.sort(NgGridHelper.sortItemsByPositionVertical);
                const lowestRowPerColumn: Map<number, number> = new Map<number, number>();

                for (let item of itemsInGrid) {
                    if (item.isFixed) continue;

                    const itemDims: NgGridItemSize = item.getSize();
                    const itemPos: NgGridItemPosition = item.getGridPosition();

                    let lowestRowForItem: number = lowestRowPerColumn.get(itemPos.col) || 1;

                    for (let i: number = 1; i < itemDims.x; i++) {
                        const lowestRowForColumn = lowestRowPerColumn.get(itemPos.col + i) || 1;
                        lowestRowForItem = Math.max(lowestRowForColumn, lowestRowForItem);
                    }

                    const leftCol = itemPos.col;
                    const rightCol = itemPos.col + itemDims.x;

                    if (pos && dims) {
                        const withinColumns = rightCol > pos.col && leftCol < (pos.col + dims.x);

                        if (withinColumns) {          // If our element is in one of the item's columns
                            const roomAboveItem = itemDims.y <= (pos.row - lowestRowForItem);

                            if (!roomAboveItem) {                                                  // Item can't fit above our element
                                lowestRowForItem = Math.max(lowestRowForItem, pos.row + dims.y);   // Set the lowest row to be below it
                            }
                        }
                    }

                    const newPos: NgGridItemPosition = { col: itemPos.col, row: lowestRowForItem };

                    //    What if it's not within bounds Y?
                    if (lowestRowForItem != itemPos.row && this._isWithinBoundsY(newPos, itemDims)) { // If the item is not already on this row move it up
                        this._removeFromGrid(item);

                        item.setGridPosition(newPos);

                        item.onCascadeEvent();
                        this._addToGrid(item);
                    }

                    for (let i: number = 0; i < itemDims.x; i++) {
                        lowestRowPerColumn.set(itemPos.col + i, lowestRowForItem + itemDims.y); // Update the lowest row to be below the item
                    }
                }
                break;
            case 'left':
            case 'right':
                itemsInGrid = itemsInGrid.sort(NgGridHelper.sortItemsByPositionHorizontal);
                const lowestColumnPerRow: Map<number, number> = new Map<number, number>();

                for (let item of itemsInGrid) {
                    const itemDims: NgGridItemSize = item.getSize();
                    const itemPos: NgGridItemPosition = item.getGridPosition();

                    let lowestColumnForItem: number = lowestColumnPerRow.get(itemPos.row) || 1;

                    for (let i: number = 1; i < itemDims.y; i++) {
                        let lowestOffsetColumn: number = lowestColumnPerRow.get(itemPos.row + i) || 1;
                        lowestColumnForItem = Math.max(lowestOffsetColumn, lowestColumnForItem);
                    }

                    const topRow = itemPos.row;
                    const bottomRow = itemPos.row + itemDims.y;

                    if (pos && dims) {
                        const withinRows = bottomRow > pos.col && topRow < (pos.col + dims.x);

                        if (withinRows) {          // If our element is in one of the item's rows
                            const roomNextToItem = itemDims.x <= (pos.col - lowestColumnForItem);

                            if (!roomNextToItem) {                                                      // Item can't fit next to our element
                                lowestColumnForItem = Math.max(lowestColumnForItem, pos.col + dims.x);  // Set the lowest col to be the other side of it
                            }
                        }
                    }

                    const newPos: NgGridItemPosition = { col: lowestColumnForItem, row: itemPos.row };

                    if (lowestColumnForItem != itemPos.col && this._isWithinBoundsX(newPos, itemDims)) { // If the item is not already on this col move it up
                        this._removeFromGrid(item);

                        item.setGridPosition(newPos);

                        item.onCascadeEvent();
                        this._addToGrid(item);
                    }

                    for (let i: number = 0; i < itemDims.y; i++) {
                        lowestColumnPerRow.set(itemPos.row + i, lowestColumnForItem + itemDims.x); // Update the lowest col to be below the item
                    }
                }
                break;
            default:
                break;
        }
    }

    private _fixGridPosition(pos: NgGridItemPosition, dims: NgGridItemSize): NgGridItemPosition {
        if (!this._hasGridCollision(pos, dims)) return pos;

        const maxRow = this._maxRows === 0 ? this._getMaxRow() : this._maxRows;
        const maxCol = this._maxCols === 0 ? this._getMaxCol() : this._maxCols;
        const newPos = {
            col: pos.col,
            row: pos.row,
        };

        if (this._itemFixDirection === 'vertical') {
            fixLoop:
            for (; newPos.col <= maxRow;) {
                const itemsInPath = this._getItemsInVerticalPath(newPos, dims, newPos.row);
                let nextRow = newPos.row;

                for (let item of itemsInPath) {
                    if (item.row - nextRow >= dims.y) {
                        newPos.row = nextRow;
                        break fixLoop;
                    }

                    nextRow = item.row + item.sizey;
                }

                if (maxRow - nextRow >= dims.y) {
                    newPos.row = nextRow;
                    break fixLoop;
                }

                newPos.col = Math.max(newPos.col + 1, Math.min.apply(Math, itemsInPath.map((item) => item.col + dims.x)));
                newPos.row = 1;
            }
        } else if (this._itemFixDirection === 'horizontal') {
            fixLoop:
            for (; newPos.row <= maxRow;) {
                const itemsInPath = this._getItemsInHorizontalPath(newPos, dims, newPos.col);
                let nextCol = newPos.col;

                for (let item of itemsInPath) {
                    if (item.col - nextCol >= dims.x) {
                        newPos.col = nextCol;
                        break fixLoop;
                    }

                    nextCol = item.col + item.sizex;
                }

                if (maxCol - nextCol >= dims.x) {
                    newPos.col = nextCol;
                    break fixLoop;
                }

                newPos.row = Math.max(newPos.row + 1, Math.min.apply(Math, itemsInPath.map((item) => item.row + dims.y)));
                newPos.col = 1;
            }
        }

        return newPos;
    }

    private _getItemsInHorizontalPath(pos: NgGridItemPosition, dims: NgGridItemSize, startColumn: number = 0): NgGridItem[] {
        const itemsInPath: NgGridItem[] = [];
        const topRow: number = pos.row + dims.y - 1;

        this._itemsInGrid.forEach((itemId: string) => {
            const item = this._items.get(itemId);
            if (item.col + item.sizex - 1 < startColumn) { return; }    // Item falls after start column
            if (item.row > topRow) { return; }                          // Item falls above path
            if (item.row + item.sizey - 1 < pos.row) { return; }        // Item falls below path
            itemsInPath.push(item);
        });

        return itemsInPath;
    }

    private _getItemsInVerticalPath(pos: NgGridItemPosition, dims: NgGridItemSize, startRow: number = 0): NgGridItem[] {
        const itemsInPath: NgGridItem[] = [];
        const rightCol: number = pos.col + dims.x - 1;

        this._itemsInGrid.forEach((itemId: string) => {
            const item = this._items.get(itemId);
            if (item.row + item.sizey - 1 < startRow) { return; }   // Item falls above start row
            if (item.col > rightCol) { return; }                    // Item falls after path
            if (item.col + item.sizex - 1 < pos.col) { return; }    // Item falls before path
            itemsInPath.push(item);
        });

        return itemsInPath;
    }

    private _isWithinBoundsX(pos: NgGridItemPosition, dims: NgGridItemSize, allowExcessiveItems: boolean = false) {
        return this._maxCols == 0 || (allowExcessiveItems && pos.col == 1) || (pos.col + dims.x - 1) <= this._maxCols;
    }

    private _fixPosToBoundsX(pos: NgGridItemPosition, dims: NgGridItemSize): NgGridItemPosition {
        if (!this._isWithinBoundsX(pos, dims)) {
            pos.col = Math.max(this._maxCols - (dims.x - 1), 1);
            pos.row++;
        }
        return pos;
    }

    private _fixSizeToBoundsX(pos: NgGridItemPosition, dims: NgGridItemSize): NgGridItemSize {
        if (!this._isWithinBoundsX(pos, dims)) {
            dims.x = Math.max(this._maxCols - (pos.col - 1), 1);
            dims.y++;
        }
        return dims;
    }

    private _isWithinBoundsY(pos: NgGridItemPosition, dims: NgGridItemSize, allowExcessiveItems: boolean = false) {
        return this._maxRows == 0 || (allowExcessiveItems && pos.row == 1) || (pos.row + dims.y - 1) <= this._maxRows;
    }

    private _fixPosToBoundsY(pos: NgGridItemPosition, dims: NgGridItemSize): NgGridItemPosition {
        if (!this._isWithinBoundsY(pos, dims)) {
            pos.row = Math.max(this._maxRows - (dims.y - 1), 1);
            pos.col++;
        }
        return pos;
    }

    private _fixSizeToBoundsY(pos: NgGridItemPosition, dims: NgGridItemSize): NgGridItemSize {
        if (!this._isWithinBoundsY(pos, dims)) {
            dims.y = Math.max(this._maxRows - (pos.row - 1), 1);
            dims.x++;
        }
        return dims;
    }

    private _isWithinBounds(pos: NgGridItemPosition, dims: NgGridItemSize, allowExcessiveItems: boolean = false) {
        return this._isWithinBoundsX(pos, dims, allowExcessiveItems) && this._isWithinBoundsY(pos, dims, allowExcessiveItems);
    }

    private _fixPosToBounds(pos: NgGridItemPosition, dims: NgGridItemSize): NgGridItemPosition {
        return this._fixPosToBoundsX(this._fixPosToBoundsY(pos, dims), dims);
    }

    private _fixSizeToBounds(pos: NgGridItemPosition, dims: NgGridItemSize): NgGridItemSize {
        return this._fixSizeToBoundsX(pos, this._fixSizeToBoundsY(pos, dims));
    }

    private _addToGrid(item: NgGridItem): void {
        let pos: NgGridItemPosition = item.getGridPosition();
        const dims: NgGridItemSize = item.getSize();

        if (this._hasGridCollision(pos, dims)) {
            this._fixGridCollisions(pos, dims);
            pos = item.getGridPosition();
        }

        if (this._allowOverlap) {
            item.zIndex = this._lastZValue++;
        }

        this._itemsInGrid.add(item.uid);
    }

    private _removeFromGrid(item: NgGridItem): void {
        this._itemsInGrid.delete(item.uid);
    }

    private _updateSize(): void {
        if (this._destroyed) return;
        let maxCol: number = this._getMaxCol();
        let maxRow: number = this._getMaxRow();

        if (maxCol != this._curMaxCol || maxRow != this._curMaxRow) {
            this._curMaxCol = maxCol;
            this._curMaxRow = maxRow;
        }

        this._renderer.setStyle(this._ngEl.nativeElement, 'width', '100%');//(maxCol * (this.colWidth + this.marginLeft + this.marginRight))+'px');
        if (!this._elementBasedDynamicRowHeight) {
            this._renderer.setStyle(this._ngEl.nativeElement, 'height', (maxRow * (this.rowHeight + this.marginTop + this.marginBottom)) + 'px');
        }
    }

    private _getMaxRow(): number {
        const itemsRows: number[] = Array.from(this._itemsInGrid, (itemId: string) => {
            const item = this._items.get(itemId);
            if (!item) return 0;
            return item.row + item.sizey - 1;
        });

        return Math.max.apply(null, itemsRows);
    }

    private _getMaxCol(): number {
        const itemsCols: number[] = Array.from(this._itemsInGrid, (itemId: string) => {
            const item = this._items.get(itemId);
            if (!item) return 0;
            return item.col + item.sizex - 1;
        });

        return Math.max.apply(null, itemsCols);
    }

    private _getMousePosition(e: any): NgGridRawPosition {
        if (((<any>window).TouchEvent && e instanceof TouchEvent) || (e.touches || e.changedTouches)) {
            e = e.touches.length > 0 ? e.touches[0] : e.changedTouches[0];
        }

        const refPos: any = this._ngEl.nativeElement.getBoundingClientRect();

        let left: number = e.clientX - refPos.left;
        let top: number = e.clientY - refPos.top;

        if (this.cascade == 'down') top = refPos.top + refPos.height - e.clientY;
        if (this.cascade == 'right') left = refPos.left + refPos.width - e.clientX;

        if (this.isDragging && this._zoomOnDrag) {
            left *= 2;
            top *= 2;
        }

        return {
            left: left,
            top: top
        };
    }

    private _getAbsoluteMousePosition(e: any): NgGridRawPosition {
        if (((<any>window).TouchEvent && e instanceof TouchEvent) || (e.touches || e.changedTouches)) {
            e = e.touches.length > 0 ? e.touches[0] : e.changedTouches[0];
        }

        return {
            left: e.clientX,
            top: e.clientY
        };
    }

    private _getContainerColumns(): number {
        const maxWidth: number = this._ngEl.nativeElement.getBoundingClientRect().width;
        const itemWidth: number = this.colWidth + this.marginLeft + this.marginRight;
        return Math.floor(maxWidth / itemWidth);
    }

    private _getContainerRows(): number {
        const maxHeight: number = window.innerHeight - this.marginTop - this.marginBottom;
        return Math.floor(maxHeight / (this.rowHeight + this.marginTop + this.marginBottom));
    }

    private _getScreenMargin(): number {
        const maxWidth: number = this._ngEl.nativeElement.getBoundingClientRect().width;
        const itemWidth: number = this.colWidth + this.marginLeft + this.marginRight;
        return Math.floor((maxWidth - (this._maxCols * itemWidth)) / 2);;
    }

    private _getItemFromPosition(position: NgGridRawPosition): NgGridItem {
        return Array.from(this._itemsInGrid, (itemId: string) => (this._items.get(itemId) as NgGridItem)).find((item: NgGridItem) => {
            if (!item) return false;

            const size: NgGridItemDimensions = item.getDimensions();
            const pos: NgGridRawPosition = item.getPosition();

            return position.left >= pos.left && position.left < (pos.left + size.width) &&
                position.top >= pos.top && position.top < (pos.top + size.height);
        });
    }

    private _createPlaceholder(item: NgGridItem): void {
        const pos: NgGridItemPosition = item.getGridPosition();
        const dims: NgGridItemSize = item.getSize();

        const factory = this.componentFactoryResolver.resolveComponentFactory(NgGridPlaceholder);
        var componentRef: ComponentRef<NgGridPlaceholder> = item.containerRef.createComponent(factory);
        this._placeholderRef = componentRef;
        const placeholder: NgGridPlaceholder = componentRef.instance;
        placeholder.registerGrid(this);
        placeholder.setCascadeMode(this.cascade);
        placeholder.setGridPosition({ col: pos.col, row: pos.row });
        placeholder.setSize({ x: dims.x, y: dims.y });
    }

    private _emitOnItemChange() {
        const itemOutput: any[] = Array.from(this._itemsInGrid)
            .map((itemId: string) => this._items.get(itemId))
            .filter((item: NgGridItem) => !!item)
            .map((item: NgGridItem) => item.getEventOutput());

        this.onItemChange.emit(itemOutput);
    }

    private _defineListeners(): void {
        const element = this._ngEl.nativeElement;

        this._documentMousemove$ = fromEvent<MouseEvent>(document, 'mousemove');
        this._documentMouseup$ = fromEvent<MouseEvent>(document, 'mouseup');
        this._mousedown$ = fromEvent(element, 'mousedown');
        this._mousemove$ = fromEvent(element, 'mousemove');
        this._mouseup$ = fromEvent(element, 'mouseup');
        this._touchstart$ = fromEvent(element, 'touchstart');
        this._touchmove$ = fromEvent(element, 'touchmove');
        this._touchend$ = fromEvent(element, 'touchend');
    }

    private _enableListeners(): void {
        if (this._enabledListener) {
            return;
        }

        this._enableMouseListeners();
        this._enableResizeListener();

        if (this._isTouchDevice()) {
            this._enableTouchListeners();
        }

        this._enabledListener = true;
    }
    private _enableResizeListener() {
        // add event listeners outside of angular zone
        this._ngZone.runOutsideAngular(() => {
            window.addEventListener("resize", this.resizeEventHandler, true);
        });
    }

    private _disableListeners(): void {
        window.removeEventListener("resize", this.resizeEventHandler, true);
        this._subscriptions.forEach((subs: Subscription) => subs.unsubscribe());
        this._enabledListener = false;
    }

    private _isTouchDevice(): boolean {
        return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    };

    private _enableTouchListeners(): void {
        // add event listeners outside of angular zone
        this._ngZone.runOutsideAngular(() => {
            const touchstartSubs = this._touchstart$.subscribe((e: TouchEvent) => this.mouseDownEventHandler(e));
            const touchmoveSubs = this._touchmove$.subscribe((e: TouchEvent) => this.mouseMoveEventHandler(e));
            const touchendSubs = this._touchend$.subscribe((e: TouchEvent) => this.mouseUpEventHandler(e));

            this._subscriptions.push(
                touchstartSubs,
                touchmoveSubs,
                touchendSubs
            );
        });
    }

    private _enableMouseListeners(): void {
        // add event listeners outside of angular zone
        this._ngZone.runOutsideAngular(() => {
            const documentMousemoveSubs = this._documentMousemove$.subscribe((e: MouseEvent) => this.mouseMoveEventHandler(e));
            const documentMouseupSubs = this._documentMouseup$.subscribe((e: MouseEvent) => this.mouseUpEventHandler(e));
            const mousedownSubs = this._mousedown$.subscribe((e: MouseEvent) => this.mouseDownEventHandler(e));
            const mousemoveSubs = this._mousemove$.subscribe((e: MouseEvent) => this.mouseMoveEventHandler(e));
            const mouseupSubs = this._mouseup$.subscribe((e: MouseEvent) => this.mouseUpEventHandler(e));

            this._subscriptions.push(
                documentMousemoveSubs,
                documentMouseupSubs,
                mousedownSubs,
                mousemoveSubs,
                mouseupSubs
            );
        });

    }
}
