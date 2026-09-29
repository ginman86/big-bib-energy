// Imported (GPX) courses: kept in this browser, and synced to the account when signed in.

import type { Course } from '../core/course';
import { customStore } from './custom-store';

const store = customStore<Course>('bbe.courses', 'courses', 'course');

export const localCourses = store.local;
export const saveCourse = store.save;
export const deleteCourse = store.remove;
export const syncCourses = store.sync;
