import { NgModule } from '@angular/core';
import { NgGrid } from '../directives/NgGrid';
import { NgGridItem } from '../directives/NgGridItem';
import { NgGridPlaceholder } from '../components/NgGridPlaceholder';

/**
 * @deprecated, please prefer importing the standalone components instead.
 */
@NgModule({
    imports: [NgGrid, NgGridItem, NgGridPlaceholder],
    exports: [NgGrid, NgGridItem]
})
export class NgGridModule {}
