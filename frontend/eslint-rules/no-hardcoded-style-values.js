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
        && /(?:^|\s)\d+(?:\.\d+)?px(?:\s|$)/i.test(value);
      if (hasLiteralColor || hasPixelSpacing) {
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
        if (
          node.name?.type === 'JSXIdentifier'
          && (node.name.name === 'fill' || node.name.name === 'stroke')
          && node.value?.type === 'Literal'
          && typeof node.value.value === 'string'
          && /#[0-9a-f]{3,8}\b/i.test(node.value.value)
        ) {
          context.report({
            node: node.value,
            messageId: 'token',
            data: { value: JSON.stringify(node.value.value) },
          });
        }
      },
    };
  },
};

export default noHardcodedStyleValuesRule;
