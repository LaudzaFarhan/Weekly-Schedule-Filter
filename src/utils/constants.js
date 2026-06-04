export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export const BRANCH_WORKING_DAYS = {
  Bintaro: ['Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  default: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
};

export const getWorkingDaysForBranch = (branchName) => {
  return BRANCH_WORKING_DAYS[branchName] || BRANCH_WORKING_DAYS.default;
};

export const SCHEDULE_PAGE_SIZE = 8;
export const CARDS_PER_PAGE = 3;
export const LIST_PAGE_SIZE = 8;
