import js from '@eslint/js'
import tseslint from 'typescript-eslint'

/**
 * ESLint de Nexus ERP.
 *
 * Ademas del estilo, aqui viven las reglas que hacen cumplir la arquitectura.
 * Si una de estas falla, no es un detalle de formato: es un principio roto.
 */
export default tseslint.config(
  { ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', '**/.turbo/**', '**/*.d.ts'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  // ────────────────────────────────────────────────────────────────
  //  SEGURIDAD — el tenant_id SOLO viene del JWT
  //  Documento maestro §10.  Leerlo del request es un hallazgo CRITICO.
  // ────────────────────────────────────────────────────────────────
  {
    files: ['apps/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}', 'modules/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "MemberExpression[property.name='tenant_id'][object.property.name=/^(body|params|query|searchParams|formData)$/]",
          message:
            'CRITICO: tenant_id solo puede venir del JWT (app_metadata). Leerlo del request permite suplantar tenants. Ver §10 del documento maestro.',
        },
        {
          selector: "CallExpression[callee.property.name='get'][arguments.0.value='tenant_id']",
          message:
            'CRITICO: tenant_id solo puede venir del JWT (app_metadata), nunca de searchParams/headers/formData.',
        },
      ],
    },
  },

  // ────────────────────────────────────────────────────────────────
  //  ARQUITECTURA — cero logica de negocio en las apps
  //  Documento maestro §15.2: "Si escribes una regla de negocio en apps/, es un bug."
  // ────────────────────────────────────────────────────────────────
  {
    files: ['apps/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/modules/*/core/*'],
              message:
                'Las apps no importan la logica interna de un modulo. Usa la API publica de @nexus/core.',
            },
          ],
        },
      ],
    },
  },

  // ────────────────────────────────────────────────────────────────
  //  MODULOS — nunca se importan entre si
  //  Documento maestro §4.3: se comunican por eventos o por `requires`.
  // ────────────────────────────────────────────────────────────────
  {
    files: ['modules/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/modules/*/**', '@nexus/mod-*'],
              message:
                'Un modulo nunca importa otro modulo. Declaralo en `requires` y usa @nexus/core, o escucha su evento. Ver §4.3.',
            },
          ],
        },
      ],
    },
  },

  // Scripts de Node (auditorias, migraciones, generacion de tokens).
  // Corren en el servidor: tienen globals de Node y si pueden usar console.
  {
    files: ['scripts/**/*.mjs', '**/scripts/**/*.mjs', '**/*.config.{ts,js,mjs}', '**/build-*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        URL: 'readonly',
        crypto: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
      'no-undef': 'off',
    },
  },

  // Tests: globals de vitest y de Node.
  {
    files: ['**/*.test.ts', '**/tests/**/*.ts'],
    languageOptions: {
      globals: { crypto: 'readonly', process: 'readonly', console: 'readonly' },
    },
    rules: { 'no-console': 'off' },
  },
)
