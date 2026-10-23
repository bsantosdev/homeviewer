import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { appConfig } from './app.config';
import { routes } from './app.routes';

describe('appConfig', () => {
  it('provides HttpClient and the app routes', () => {
    TestBed.configureTestingModule({ providers: appConfig.providers });
    expect(TestBed.inject(HttpClient)).toBeInstanceOf(HttpClient);
    expect(TestBed.inject(Router).config).toEqual(routes);
  });
});
