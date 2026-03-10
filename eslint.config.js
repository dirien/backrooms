import js from '@eslint/js';
import globals from 'globals';
import importPlugin from 'eslint-plugin-import';
import sonarjs from 'eslint-plugin-sonarjs';
import unicorn from 'eslint-plugin-unicorn';

const hotPathFunctionSelector =
    "FunctionDeclaration[id.name=/^(animate|update.*|handleCollision|checkPhoneTap|entityCollidesWithWalls|hasLineOfSight)$/]";

export default [
    {
        ignores: ['dist/**', 'node_modules/**', 'eslint.config.js'],
    },
    js.configs.recommended,
    importPlugin.flatConfigs.recommended,
    sonarjs.configs.recommended,
    unicorn.configs['flat/recommended'],
    {
        files: ['src/**/*.js', 'vite.config.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.browser,
                ...globals.es2024,
            },
        },
        settings: {
            'import/resolver': {
                node: {
                    extensions: ['.js'],
                },
            },
        },
        rules: {
            'import/no-unresolved': 'off',
            'import/no-named-as-default': 'off',
            'import/no-named-as-default-member': 'off',
            'no-console': ['error', { allow: ['warn', 'error'] }],
            'no-undef': 'error',
            'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            'object-shorthand': ['error', 'always'],
            'prefer-const': 'error',
            'sonarjs/cognitive-complexity': ['error', 20],
            'sonarjs/no-duplicate-string': 'off',
            'sonarjs/no-ignored-exceptions': 'error',
            'sonarjs/pseudo-random': 'error',
            'sonarjs/no-redundant-assignments': 'error',
            'sonarjs/no-dead-store': 'error',
            'sonarjs/no-unused-vars': 'off',
            'unicorn/no-null': 'off',
            'unicorn/prevent-abbreviations': 'off',
            'unicorn/prefer-query-selector': 'off',
            'unicorn/prefer-top-level-await': 'off',
            'unicorn/prefer-module': 'off',
            'unicorn/no-array-for-each': 'off',
            'unicorn/no-array-reduce': 'off',
            'unicorn/no-useless-undefined': 'off',
            'unicorn/consistent-function-scoping': 'off',
            'unicorn/prefer-number-properties': 'off',
            'unicorn/numeric-separators-style': 'off',
            'unicorn/no-nested-ternary': 'off',
            'unicorn/prefer-global-this': 'off',
            'unicorn/no-zero-fractions': 'off',
            'unicorn/number-literal-case': 'off',
            'unicorn/prefer-ternary': 'off',
            'unicorn/no-for-loop': 'off',
            'unicorn/prefer-modern-math-apis': 'off',
            'unicorn/no-array-sort': 'off',
            'unicorn/no-lonely-if': 'off',
            'unicorn/prefer-dom-node-text-content': 'off',
            'unicorn/prefer-math-min-max': 'off',
            'unicorn/prefer-dom-node-append': 'off',
            'unicorn/catch-error-name': 'error',
            'unicorn/prefer-optional-catch-binding': 'error',
            'no-restricted-syntax': [
                'error',
                {
                    selector: `${hotPathFunctionSelector} NewExpression[callee.object.name='THREE'][callee.property.name='Vector2']`,
                    message: 'Avoid allocating THREE.Vector2 inside hot paths; reuse temp objects instead.',
                },
                {
                    selector: `${hotPathFunctionSelector} NewExpression[callee.object.name='THREE'][callee.property.name='Vector3']`,
                    message: 'Avoid allocating THREE.Vector3 inside hot paths; reuse temp objects instead.',
                },
                {
                    selector: `${hotPathFunctionSelector} NewExpression[callee.object.name='THREE'][callee.property.name='Box3']`,
                    message: 'Avoid allocating THREE.Box3 inside hot paths; cache bounds or reuse temp boxes instead.',
                },
                {
                    selector: `${hotPathFunctionSelector} NewExpression[callee.name='Float32Array']`,
                    message: 'Avoid rebuilding large typed arrays in hot paths; cache and reuse them instead.',
                },
            ],
        },
    },
];
