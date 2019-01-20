import { IPRCommandOptions } from '../cli/args';
import main, { AutoRelease, run } from '../main';

jest.mock(
  '@artsy/auto-config',
  () => ({
    onlyPublishWithReleaseLabel: true
  }),
  { virtual: true }
);

jest.mock(
  'auto-config-fuego',
  () => ({
    noVersionPrefix: true
  }),
  { virtual: true }
);

jest.mock(
  '../fake/path.json',
  () => ({
    jira: 'url'
  }),
  { virtual: true }
);

jest.mock(
  '../fake/path.js',
  () => () => ({
    slack: 'url'
  }),
  { virtual: true }
);

test('throws error for unknown args', async () => {
  expect.assertions(1);

  try {
    await run({
      command: 'foo'
    });
  } catch (error) {
    expect(error).toEqual(new Error("idk what i'm doing."));
  }
});

test('throws exits for caught error', async () => {
  console.log = jest.fn() as any;
  process.exit = jest.fn() as any;

  await main({
    command: 'foo'
  });

  expect(process.exit).toHaveBeenCalledWith(1);
});

const defaults = {
  owner: 'foo',
  repo: 'bar',
  token: 'XXXX'
};

const labels = {
  major: 'Version: Major',
  patch: 'Version: Patch',
  minor: 'Version: Minor'
};

const search = jest.fn();
jest.mock('cosmiconfig', () => () => ({
  search
}));

describe('AutoRelease', () => {
  test('should use args', async () => {
    const auto = new AutoRelease({ command: 'init', ...defaults });
    await auto.loadConfig();
    expect(auto.githubRelease).toBeDefined();
  });

  test('should load config', async () => {
    search.mockReturnValueOnce({ config: defaults });
    const auto = new AutoRelease({ command: 'init' });
    await auto.loadConfig();
    expect(auto.githubRelease).toBeDefined();
  });

  test('should extend config', async () => {
    search.mockReturnValueOnce({ config: { ...defaults, extends: '@artsy' } });
    const auto = new AutoRelease({ command: 'init' });
    await auto.loadConfig();
    expect(auto.githubRelease!.releaseOptions).toMatchSnapshot();
  });

  test('should use labels from config config', async () => {
    search.mockReturnValueOnce({
      config: { ...defaults, labels }
    });
    const auto = new AutoRelease({ command: 'init' });
    await auto.loadConfig();

    expect([...auto.semVerLabels!.values()]).toEqual([
      'Version: Major',
      'Version: Minor',
      'Version: Patch',
      'skip-release',
      'release',
      'prerelease'
    ]);
  });

  test('should add extra skip label', async () => {
    search.mockReturnValueOnce({
      config: {
        ...defaults,
        labels: {
          'skip-release': 'NOPE'
        }
      }
    });
    const auto = new AutoRelease({ command: 'init' });
    await auto.loadConfig();

    expect(auto.githubRelease!.releaseOptions.skipReleaseLabels).toEqual([
      'NOPE'
    ]);
  });

  describe('createLabels', () => {
    test('should throw when not initialized', async () => {
      search.mockReturnValueOnce({
        config: { ...defaults, labels }
      });
      const auto = new AutoRelease({ command: 'create-labels' });
      expect(auto.createLabels()).rejects.toBeTruthy();
    });

    test('should create the labels', async () => {
      search.mockReturnValueOnce({
        config: { ...defaults, labels }
      });
      const auto = new AutoRelease({ command: 'create-labels' });
      await auto.loadConfig();

      auto.githubRelease!.addLabelsToProject = jest.fn();
      await auto.createLabels();
      expect(auto.githubRelease!.addLabelsToProject).toMatchSnapshot();
    });
  });

  describe('label', () => {
    test('should throw when not initialized', async () => {
      search.mockReturnValueOnce({
        config: { ...defaults, labels }
      });
      const auto = new AutoRelease({ command: 'labels' });
      expect(auto.label({ pr: 13 })).rejects.toBeTruthy();
    });

    test('should get labels', async () => {
      const auto = new AutoRelease({ command: 'labels', ...defaults });
      await auto.loadConfig();

      const getLabels = jest.fn();
      auto.githubRelease!.getLabels = getLabels;
      getLabels.mockReturnValueOnce(['foo']);
      console.log = jest.fn();

      await auto.label({ pr: 13 });
      expect(console.log).toHaveBeenCalledWith('foo');
    });

    test('should get labels for last merged PR', async () => {
      const auto = new AutoRelease({ command: 'labels', ...defaults });
      await auto.loadConfig();

      const getPullRequests = jest.fn();
      auto.githubRelease!.getPullRequests = getPullRequests;
      getPullRequests.mockReturnValueOnce([
        {
          merged_at: '2019-01-08T03:45:33.000Z',
          labels: [{ name: 'wubbalublub' }]
        },
        {
          merged_at: '2019-01-10T03:45:33.000Z',
          labels: [{ name: 'foo' }, { name: 'bar' }]
        }
      ]);
      console.log = jest.fn();

      await auto.label();
      expect(console.log).toHaveBeenCalledWith('foo\nbar');
    });

    test('should do nothing when no last merge found', async () => {
      const auto = new AutoRelease({ command: 'labels', ...defaults });
      await auto.loadConfig();

      const getPullRequests = jest.fn();
      auto.githubRelease!.getPullRequests = getPullRequests;
      getPullRequests.mockReturnValueOnce([]);
      console.log = jest.fn();

      await auto.label();
      expect(console.log).not.toHaveBeenCalled();
    });
  });

  describe('pr', () => {
    let createStatus: jest.Mock;

    beforeEach(() => {
      createStatus = jest.fn();
    });

    const required: IPRCommandOptions = {
      url: 'https://google.com',
      state: 'pending',
      description: 'foo',
      context: 'bar'
    };

    test('should throw when not initialized', async () => {
      const auto = new AutoRelease({ command: 'pr', ...defaults });
      expect(auto.pr(required)).rejects.toBeTruthy();
    });

    test('should do nothing with dryRun', async () => {
      const auto = new AutoRelease({ command: 'pr', ...defaults });
      await auto.loadConfig();

      await auto.pr({ ...required, sha: '1234', dryRun: true });
      expect(createStatus).not.toHaveBeenCalled();
    });

    test('should use provided SHA', async () => {
      const auto = new AutoRelease({ command: 'pr', ...defaults });
      await auto.loadConfig();
      auto.githubRelease!.createStatus = createStatus;

      await auto.pr({ ...required, sha: '1234' });
      expect(createStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          sha: '1234'
        })
      );
    });

    test('should use HEAD SHA', async () => {
      const auto = new AutoRelease({ command: 'pr', ...defaults });
      await auto.loadConfig();
      auto.githubRelease!.createStatus = createStatus;

      const getSha = jest.fn();
      auto.githubRelease!.getSha = getSha;
      getSha.mockReturnValueOnce('abc');

      await auto.pr({ ...required });
      expect(createStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          sha: 'abc'
        })
      );
    });

    test('should use lookup SHA for PR', async () => {
      const auto = new AutoRelease({ command: 'pr', ...defaults });
      await auto.loadConfig();
      auto.githubRelease!.createStatus = createStatus;

      const getPullRequest = jest.fn();
      auto.githubRelease!.getPullRequest = getPullRequest;
      getPullRequest.mockReturnValueOnce({ data: { head: { sha: 'deep' } } });

      await auto.pr({ ...required, pr: 14 });
      expect(createStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          sha: 'deep'
        })
      );
    });
  });

  describe('pr-check', () => {
    jest.setTimeout(10 * 1000);
    let createStatus: jest.Mock;

    beforeEach(() => {
      createStatus = jest.fn();
    });

    const required = {
      url: 'https://google.com'
    };

    test('should throw when not initialized', async () => {
      const auto = new AutoRelease({ command: 'pr', ...defaults });
      expect(auto.prCheck({ pr: 13, ...required })).rejects.toBeTruthy();
    });

    test('should do nothing with dryRun', async () => {
      const auto = new AutoRelease({ command: 'pr', ...defaults });
      await auto.loadConfig();

      await auto.prCheck({ ...required, pr: 13, dryRun: true });
      expect(createStatus).not.toHaveBeenCalled();
    });

    test('should catch errors', async () => {
      const auto = new AutoRelease({ command: 'pr', ...defaults });
      await auto.loadConfig();
      auto.githubRelease!.createStatus = createStatus;

      await auto.prCheck({ ...required, pr: 13 });
      expect(createStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'error'
        })
      );
    });

    test('should error with no label', async () => {
      const auto = new AutoRelease({ command: 'pr', ...defaults });
      await auto.loadConfig();
      auto.githubRelease!.createStatus = createStatus;

      const getPullRequest = jest.fn();
      auto.githubRelease!.getPullRequest = getPullRequest;
      getPullRequest.mockReturnValueOnce({ data: { head: { sha: 'sha' } } });

      const getLabels = jest.fn();
      auto.githubRelease!.getLabels = getLabels;
      getLabels.mockReturnValueOnce([]);

      await auto.prCheck({ ...required, pr: 13 });
      expect(createStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'No semver label!'
        })
      );
    });

    test('should pass with semver label', async () => {
      const auto = new AutoRelease({ command: 'pr', ...defaults });
      await auto.loadConfig();
      auto.githubRelease!.createStatus = createStatus;

      const getPullRequest = jest.fn();
      auto.githubRelease!.getPullRequest = getPullRequest;
      getPullRequest.mockReturnValueOnce({ data: { head: { sha: 'sha' } } });

      const getLabels = jest.fn();
      auto.githubRelease!.getLabels = getLabels;
      getLabels.mockReturnValueOnce(['major']);

      await auto.prCheck({ ...required, pr: 13 });
      expect(createStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'CI - major'
        })
      );
    });

    test('should pass with skip release label', async () => {
      const auto = new AutoRelease({ command: 'pr', ...defaults });
      await auto.loadConfig();
      auto.githubRelease!.createStatus = createStatus;

      const getPullRequest = jest.fn();
      auto.githubRelease!.getPullRequest = getPullRequest;
      getPullRequest.mockReturnValueOnce({ data: { head: { sha: 'sha' } } });

      const getLabels = jest.fn();
      auto.githubRelease!.getLabels = getLabels;
      getLabels.mockReturnValueOnce(['major', 'skip-release']);

      await auto.prCheck({ ...required, pr: 13 });
      expect(createStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'PR will not create a release'
        })
      );
    });

    test('should pass with skip release label', async () => {
      const auto = new AutoRelease({ command: 'pr', ...defaults });
      await auto.loadConfig();
      auto.githubRelease!.createStatus = createStatus;

      const getPullRequest = jest.fn();
      auto.githubRelease!.getPullRequest = getPullRequest;
      getPullRequest.mockReturnValueOnce({ data: { head: { sha: 'sha' } } });

      const getLabels = jest.fn();
      auto.githubRelease!.getLabels = getLabels;
      getLabels.mockReturnValueOnce(['major', 'release']);

      await auto.prCheck({ ...required, pr: 13 });
      expect(createStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'PR will create release once merged - major'
        })
      );
    });
  });

  describe('comment', () => {
    test('should throw when not initialized', async () => {
      const auto = new AutoRelease({ command: 'comment', ...defaults });
      expect(auto.comment({ pr: 10, message: 'foo' })).rejects.toBeTruthy();
    });

    test('should make a comment', async () => {
      const auto = new AutoRelease({ command: 'comment', ...defaults });
      await auto.loadConfig();

      const createComment = jest.fn();
      auto.githubRelease!.createComment = createComment;

      await auto.comment({ pr: 10, message: 'foo' });
      expect(createComment).toHaveBeenCalled();
    });
  });

  describe('version', () => {
    test('should throw when not initialized', async () => {
      const auto = new AutoRelease({ command: 'comment', ...defaults });
      expect(auto.version()).rejects.toBeTruthy();
    });

    test('should make a comment', async () => {
      const auto = new AutoRelease({ command: 'comment', ...defaults });
      await auto.loadConfig();

      const getSemverBump = jest.fn();
      auto.githubRelease!.getLatestRelease = jest.fn();
      auto.githubRelease!.getSemverBump = getSemverBump;
      getSemverBump.mockReturnValueOnce('patch');
      console.log = jest.fn();

      await auto.version();
      expect(console.log).toHaveBeenCalledWith('patch');
    });
  });

  describe('changelog', () => {
    test('should throw when not initialized', async () => {
      const auto = new AutoRelease({ command: 'comment', ...defaults });
      expect(auto.changelog()).rejects.toBeTruthy();
    });

    test('should do nothing on a dryRun', async () => {
      const auto = new AutoRelease({ command: 'comment', ...defaults });
      await auto.loadConfig();

      const addToChangelog = jest.fn();
      auto.githubRelease!.addToChangelog = addToChangelog;
      auto.githubRelease!.generateReleaseNotes = jest.fn();

      await auto.changelog({ from: 'v1.0.0', dryRun: true });
      expect(addToChangelog).not.toHaveBeenCalled();
    });

    test('should add to changelog', async () => {
      const auto = new AutoRelease({
        command: 'changelog',
        plugins: [],
        ...defaults
      });
      auto.hooks.getRepository.tap('test', () => ({ token: '1234' }));
      await auto.loadConfig();

      const addToChangelog = jest.fn();
      auto.githubRelease!.addToChangelog = addToChangelog;
      auto.githubRelease!.generateReleaseNotes = jest.fn();

      await auto.changelog({ from: 'v1.0.0' });
      expect(addToChangelog).toHaveBeenCalled();
    });

    test('should skip getRepository hook if passed in via cli', async () => {
      const auto = new AutoRelease({
        command: 'pr',
        repo: 'test',
        owner: 'adierkens'
      });

      const hookFn = jest.fn();
      auto.hooks.getRepository.tap('test', hookFn);
      await auto.loadConfig();
      await auto.pr({
        url: 'foo.bar',
        state: 'pending',
        description: 'Waiting for stuffs',
        context: 'tests',
        dryRun: true
      });

      expect(hookFn).not.toBeCalled();
    });
  });

  describe('loadExtendConfig', () => {
    test('should work when no config found', async () => {
      const auto = new AutoRelease({ command: 'comment', ...defaults });
      expect(auto.loadExtendConfig('nothing')).toEqual({});
    });

    test('should load file path', async () => {
      const auto = new AutoRelease({ command: 'comment', ...defaults });
      expect(auto.loadExtendConfig('../fake/path.json')).toEqual({
        jira: 'url'
      });
    });

    test('should load @NAME/auto-config', async () => {
      const auto = new AutoRelease({ command: 'comment', ...defaults });
      expect(auto.loadExtendConfig('@artsy')).toEqual({
        onlyPublishWithReleaseLabel: true
      });
    });

    test('should load auto-config-NAME', async () => {
      const auto = new AutoRelease({ command: 'comment', ...defaults });
      expect(auto.loadExtendConfig('fuego')).toEqual({
        noVersionPrefix: true
      });
    });
    test('should load extend config from function', async () => {
      const auto = new AutoRelease({ command: 'comment', ...defaults });
      expect(auto.loadExtendConfig('../fake/path.js')).toEqual({
        slack: 'url'
      });
    });
  });
});
