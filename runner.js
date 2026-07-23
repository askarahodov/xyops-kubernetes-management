#!/usr/bin/env node
'use strict';

const { emit, main } = require('./index');

main().catch((error) => {
  emit({
    code: 1,
    description: error.message || String(error),
    details: error.kubernetesStatus
      ? `Kubernetes API status: \`${error.kubernetesStatus}\``
      : undefined
  });
  process.exitCode = 1;
});
