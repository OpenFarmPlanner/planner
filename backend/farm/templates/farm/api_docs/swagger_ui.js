"use strict";

{% comment %}
Replaces drf-spectacular's bundled script (see PublicSwaggerView in
farm/agent_api/schema_views.py). Differences: no CSRF header and
`credentials: "omit"` on every request, so "Try it out" never rides on the
visitor's session cookie and authenticates only with the Bearer token entered
under "Authorize". Nothing is persisted in browser storage.
{% endcomment %}
const swaggerSettings = {{ settings|safe }};

const requestInterceptor = (request) => {
  request.credentials = "omit";
  return request;
};

const ui = SwaggerUIBundle({
  url: "{{ schema_url|escapejs }}",
  dom_id: "#swagger-ui",
  presets: [SwaggerUIBundle.presets.apis],
  layout: "BaseLayout",
  ...swaggerSettings,
  requestInterceptor,
  persistAuthorization: false,
});
