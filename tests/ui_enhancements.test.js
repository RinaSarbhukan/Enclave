/**
 * Tests for UI Enhancements:
 * - animateCounter in js/utils.js
 * - CHART_THEMES, getChartThemeKey, setChartThemeKey, getActivePalettes in js/chartRenderer.js
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { animateCounter } from '../js/utils.js';
import { CHART_THEMES, getChartThemeKey, setChartThemeKey, getActivePalettes } from '../js/chartRenderer.js';

describe('UI Enhancements - animateCounter', () => {
  it('gracefully handles null element without throwing', () => {
    assert.doesNotThrow(() => {
      animateCounter(null, 100);
    });
  });

  it('immediately sets final value when duration is 0 or in node environment', () => {
    const mockEl = { textContent: '' };
    animateCounter(mockEl, 1500, { duration: 0, suffix: ' rows' });
    assert.strictEqual(mockEl.textContent, '1,500 rows');
  });

  it('respects prefix and decimal options', () => {
    const mockEl = { textContent: '' };
    animateCounter(mockEl, 12.345, { duration: 0, prefix: '$', decimals: 2 });
    assert.strictEqual(mockEl.textContent, '$12.35');
  });

  it('uses custom formatter if supplied', () => {
    const mockEl = { textContent: '' };
    animateCounter(mockEl, 1024 * 1024, { duration: 0, formatter: val => `${val / 1024} KB` });
    assert.strictEqual(mockEl.textContent, '1024 KB');
  });
});

describe('UI Enhancements - Chart Color Themes', () => {
  it('defines all 5 curated themes with light and dark palettes', () => {
    const expectedThemes = ['default', 'emerald', 'sunset', 'cyber', 'pastel'];
    for (const key of expectedThemes) {
      assert.ok(CHART_THEMES[key], `Theme ${key} should exist`);
      assert.ok(Array.isArray(CHART_THEMES[key].light), `${key}.light should be an array`);
      assert.ok(Array.isArray(CHART_THEMES[key].dark), `${key}.dark should be an array`);
      assert.ok(CHART_THEMES[key].light.length >= 10, `${key}.light has at least 10 colors`);
      assert.ok(CHART_THEMES[key].dark.length >= 10, `${key}.dark has at least 10 colors`);
      assert.ok(CHART_THEMES[key].label, `${key} has a readable label`);
      assert.ok(CHART_THEMES[key].badgeColor, `${key} has a badgeColor`);
    }
  });

  it('allows changing chart theme and returns active palettes', () => {
    assert.strictEqual(setChartThemeKey('emerald'), true);
    assert.strictEqual(getChartThemeKey(), 'emerald');

    const { palette, paletteAlpha } = getActivePalettes();
    assert.ok(Array.isArray(palette));
    assert.ok(Array.isArray(paletteAlpha));
    assert.strictEqual(palette[0], CHART_THEMES.emerald.light[0]);
    assert.strictEqual(paletteAlpha[0], `${CHART_THEMES.emerald.light[0]}30`);

    // Reset back to default
    setChartThemeKey('default');
    assert.strictEqual(getChartThemeKey(), 'default');
  });

  it('rejects invalid theme key and returns false', () => {
    const result = setChartThemeKey('non_existent_theme');
    assert.strictEqual(result, false);
  });
});
