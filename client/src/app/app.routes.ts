import { Routes } from '@angular/router';
import { Admin } from './features/admin/admin';
import { Dashboard } from './dashboard/dashboard';
import { ShoppingPage } from './features/shopping/shopping-page';

export const routes: Routes = [
  { path: '', component: Dashboard },
  { path: 'admin', component: Admin },
  { path: 'list', component: ShoppingPage },
  { path: '**', redirectTo: '' },
];
