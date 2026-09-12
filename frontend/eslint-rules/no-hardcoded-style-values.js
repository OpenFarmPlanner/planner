const colorKeys = new Set([
  'color',
  'background',
  'backgroundColor',
  'bgcolor',
  'borderColor',
  'boxShadow',
  'textShadow',
  'outline',
  'outlineColor',
  'border',
]);
const spacingKeys = new Set([
  'p',
  'pt',
  'pr',
  'pb',
  'pl',
  'px',
  'py',
  'padding',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'paddingInline',
  'paddingInlineStart',
  'paddingInlineEnd',
  'paddingBlock',
  'paddingBlockStart',
  'paddingBlockEnd',
  'm',
  'mt',
  'mr',
  'mb',
  'ml',
  'mx',
  'my',
  'margin',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'marginInline',
  'marginInlineStart',
  'marginInlineEnd',
  'marginBlock',
  'marginBlockStart',
  'marginBlockEnd',
  'gap',
  'rowGap',
  'columnGap',
]);
const radiusKeys = new Set(['borderRadius']);

const noHardcodedStyleValuesRule = {
  meta: {
    type: 'suggestion',
    schema: [],
    messages: {
      token: 'Use an MUI theme token or spacing unit instead of hardcoded style value {{value}}.',
    },
  },
  create(context) {
    const checkStyleValue = (node, value) => {
      let property = node.parent;
      while (property && property.type !== 'Property' && property.type !== 'JSXAttribute') {
        property = property.parent;
      }
      if (!property || property.type !== 'Property') return;
      const key = property.key.type === 'Identifier' ? property.key.name : property.key.value;
      const propertyName = String(key);
      const hasLiteralColor = colorKeys.has(propertyName)
        && /(?:#[0-9a-f]{3,8}\b|rgba?\()/i.test(value);
      const hasPixelSpacing = spacingKeys.has(propertyName)
        && /(?:^|[^\w.])-?\d+(?:\.\d+)?px(?![\w.])/i.test(value);
      const hasPixelRadius = radiusKeys.has(propertyName)
        && /(?:^|[^\w.])-?\d+(?:\.\d+)?px(?![\w.])/i.test(value);
      if (hasLiteralColor || hasPixelSpacing || hasPixelRadius) {
        context.report({ node, messageId: 'token', data: { value: JSON.stringify(value) } });
      }
    };

    return {
      Literal(node) {
        if (typeof node.value === 'string') checkStyleValue(node, node.value);
      },
      TemplateLiteral(node) {
        checkStyleValue(node, node.quasis.map((quasi) => quasi.value.raw).join(''));
      },
      JSXAttribute(node) {
        const attributeValue = node.value?.type === 'Literal'
          ? node.value
          : node.value?.type === 'JSXExpressionContainer'
            ? node.value.expression
            : null;
        if (
          node.name?.type === 'JSXIdentifier'
          && (node.name.name === 'fill' || node.name.name === 'stroke')
          && attributeValue?.type === 'Literal'
          && typeof attributeValue.value === 'string'
          && /#[0-9a-f]{3,8}\b/i.test(attributeValue.value)
        ) {
          context.report({
            node: attributeValue,
            messageId: 'token',
            data: { value: JSON.stringify(attributeValue.value) },
          });
        }
      },
    };
  },
};

export default noHardcodedStyleValuesRule;
