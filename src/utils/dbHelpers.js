// Small helpers to build common select shapes and map joined rows
export const authorSelect = (users) => ({
    users: {
        nama: users.nama,
        username: users.username
    }
});

export const authorCampaignSelect = (users, campaigns) => ({
    ...authorSelect(users),
    campaigns: {
        title: campaigns.title,
        imageUrl: campaigns.imageUrl
    }
});

export const mapJoinedRow = (row, mainAlias = 'news') => {
    if (!row) return null;
    const main = row[mainAlias];
    return {
        ...main,
        author: row.users ? { nama: row.users.nama, username: row.users.username } : null,
        campaignId: row.campaigns ? { title: row.campaigns.title, imageUrl: row.campaigns.imageUrl } : null
    };
};

export default {
    authorSelect,
    authorCampaignSelect,
    mapJoinedRow
};
