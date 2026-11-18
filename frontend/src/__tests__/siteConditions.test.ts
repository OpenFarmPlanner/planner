import { describe, expect, it } from 'vitest';
import {
  pickInlineSiteConditions,
  resolveEffectiveConditions,
  resolveInheritedCondition,
  type SiteConditionChainNode,
} from '../components/hierarchy/utils/siteConditions';
// The cases the backend's farm/services/site_conditions.py is tested against, too.
import fixture from '../../../tests/fixtures/site_conditions.json';

type FixtureNode = (typeof fixture.cases)[number]['chain'][number];

const toNode = (node: FixtureNode): SiteConditionChainNode => ({
  level: node.level as SiteConditionChainNode['level'],
  id: node.id,
  name: node.name,
  values: node.values as SiteConditionChainNode['values'],
});

describe('resolveEffectiveConditions', () => {
  it.each(fixture.cases.map((testCase) => [testCase.name, testCase] as const))('%s', (_name, testCase) => {
    expect(resolveEffectiveConditions(testCase.chain.map(toNode))).toEqual(testCase.expected);
  });

  it('resolves what a reset to inherited would show', () => {
    const chain = fixture.cases[2].chain.map(toNode);
    expect(resolveInheritedCondition(chain, 'light_condition')).toMatchObject({
      value: 'partial_shade', source: 'field',
    });
  });
});

describe('pickInlineSiteConditions', () => {
  it('maps the inherit option to null and leaves absent properties out', () => {
    expect(pickInlineSiteConditions({ light_condition: '', irrigation: 'unavailable' })).toEqual({
      light_condition: null,
      irrigation: 'unavailable',
    });
  });
});
