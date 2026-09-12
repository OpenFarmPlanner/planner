const userFacingAttributes = new Set([
  'aria-label',
  'alt',
  'helperText',
  'label',
  'placeholder',
  'title',
]);

const noHardcodedUiStringsRule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      translate: 'Route user-visible text through the i18n resources instead of hardcoding {{value}}.',
    },
  },
  create(context) {
    const report = (node, value) => {
      if (/[A-Za-zÄÖÜäöüß]/.test(value)) {
        context.report({
          node,
          messageId: 'translate',
          data: { value: JSON.stringify(value.trim()) },
        });
      }
    };
    const inspectUiExpression = (expression) => {
      if (expression?.type === 'Literal' && typeof expression.value === 'string') {
        report(expression, expression.value);
      } else if (expression?.type === 'TemplateLiteral') {
        report(
          expression,
          expression.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join(''),
        );
      } else if (expression?.type === 'ConditionalExpression') {
        inspectUiExpression(expression.consequent);
        inspectUiExpression(expression.alternate);
      } else if (expression?.type === 'LogicalExpression') {
        inspectUiExpression(expression.right);
      } else if (expression?.type === 'BinaryExpression' && expression.operator === '+') {
        inspectUiExpression(expression.left);
        inspectUiExpression(expression.right);
      }
    };

    return {
      JSXText(node) {
        if (node.value.trim()) report(node, node.value);
      },
      JSXExpressionContainer(node) {
        const attribute = node.parent?.type === 'JSXAttribute' ? node.parent : null;
        if (
          attribute?.name?.type === 'JSXIdentifier'
          && !userFacingAttributes.has(attribute.name.name)
        ) {
          return;
        }
        inspectUiExpression(node.expression);
      },
      JSXAttribute(node) {
        if (
          node.name?.type === 'JSXIdentifier'
          && userFacingAttributes.has(node.name.name)
          && node.value?.type === 'Literal'
          && typeof node.value.value === 'string'
        ) {
          report(node.value, node.value.value);
        }
      },
    };
  },
};

export default noHardcodedUiStringsRule;
