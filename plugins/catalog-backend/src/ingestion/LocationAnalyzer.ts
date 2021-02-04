/*
 * Copyright 2020 Spotify AB
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Logger } from 'winston';
import parseGitUrl from 'git-url-parse';
import {
  AnalyzeLocationRequest,
  AnalyzeLocationResponse,
  LocationAnalyzer,
} from './types';
import { Entity } from '@backstage/catalog-model';
import { graphql } from '@octokit/graphql';
import { Config } from '@backstage/config';
import {
  ProviderConfig,
  readGithubConfig,
  GitHubRepository,
  getRepositoryDetails,
} from './processors/github';

export class RepoLocationAnalyzer implements LocationAnalyzer {
  private readonly providers: ProviderConfig[];
  private readonly logger: Logger;

  static fromConfig(config: Config, options: { logger: Logger }) {
    return new RepoLocationAnalyzer({
      ...options,
      providers: readGithubConfig(config),
    });
  }

  constructor(options: { providers: ProviderConfig[]; logger: Logger }) {
    this.providers = options.providers;
    this.logger = options.logger;
  }
  async analyzeLocation(
    request: AnalyzeLocationRequest,
  ): Promise<AnalyzeLocationResponse> {
    const { owner, name, source } = parseGitUrl(request.location.target);

    const repository = await this.getRepository(owner, name);

    const entity: Entity = {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Component',
      metadata: {
        name: name,
        description: repository.description,
        // Probably won't handle properly self-hosted git providers with custom url
        annotations: { [`${source}/project-slug`]: `${owner}/${name}` },
      },
      spec: { type: 'other', lifecycle: 'unknown' },
    };

    if (repository?.primaryLanguage?.name) {
      entity.metadata.tags = [repository.primaryLanguage.name.toLowerCase()];
    }

    this.logger.debug(`entity created for ${request.location.target}`);
    return {
      existingEntityFiles: [],
      generateEntities: [{ entity, fields: [] }],
    };
  }

  async getRepository(owner: string, name: string): Promise<GitHubRepository> {
    const provider = this.providers.find(
      p => p.target === 'https://github.com',
    );
    const client = !provider?.token
      ? graphql
      : graphql.defaults({
          baseUrl: provider.apiBaseUrl,
          headers: {
            authorization: `token ${provider.token}`,
          },
        });

    return getRepositoryDetails(client, owner, name);
  }
}
