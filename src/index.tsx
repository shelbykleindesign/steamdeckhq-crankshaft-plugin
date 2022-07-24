// TODO: Import SMM types package
type SMM = any;

// TODO: these are from main code
const deleteAll = (selector: string) =>
  document.querySelectorAll(selector).forEach((node) => node.remove());

class NetworkGetError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`Get returned error status code: ${status}`);
    this.status = status;
  }
}

const SHARED_SELECTORS = {
  appDetails: '[class*=appdetails_Container]',
  appDetailsHeader: '[class^="sharedappdetailsheader_TopCapsule"]',
  appDetailsName: 'span[class^=appdetailsplaysection_PlayBarGameName]',
};
// ==============================

enum TierColours {
  pending = '#6a6a6a',
  borked = '#ff0000',
  bronze = '#cd7f32',
  silver = '#a6a6a6',
  gold = '#cfb53b',
  platinum = '#b4c7dc',
}

const starZero = 'https://steamdeckhq.com/wp-content/uploads/2022/07/rating-0-star.svg';
const starOne = 'https://steamdeckhq.com/wp-content/uploads/2022/06/rating-1-star.svg';
const starTwo = 'https://steamdeckhq.com/wp-content/uploads/2022/06/rating-2-star.svg';
const starThree = 'https://steamdeckhq.com/wp-content/uploads/2022/06/rating-3-star.svg';
const starFour = 'https://steamdeckhq.com/wp-content/uploads/2022/06/rating-4-star.svg';
const starFive = 'https://steamdeckhq.com/wp-content/uploads/2022/06/rating-5-star.svg';

type TierRes = { tier: keyof typeof TierColours };

const getTierUrl = (appId: string) =>
  `https://steamdeckhq.com/wp-json/wp/v2/game-reviews/?meta_key=steam_app_id&meta_value=${appId}&_fields=title,acf.sdhq_rating,link.json`;

export const load = (smm: SMM) => {
  const protonDbCache: Record<string, any> = {};

  smm.addEventListener('switchToAppDetails', async (event: any) => {
    deleteAll('[data-smm-sdhq]');

    const { appId, appName } = event.detail;
    let data: TierRes = protonDbCache[appId];
    if (!data) {
      try {
        // data = await smm.Network.get<TierRes>(getTierUrl(appId));
        data = await smm.Network.get(getTierUrl(appId));
        protonDbCache[appId] = data;
      } catch (err) {
        if (err instanceof NetworkGetError) {
          smm.Toast.addToast(`Error fetching SDHQ rating for ${appName}`);
          console.info(`Error fetching SDHQ rating for app ${appId}:`, err.status);
          return;
        }
      }
    }
    const { tier } = data;

    console.log(data);
    console.log(data[0].acf.sdhq_rating);

    let starImage;
    if (data[0].acf.sdhq_rating == '0') {
        starImage = starZero;
    }
    if (data[0].acf.sdhq_rating == '1') {
        starImage = starOne;
    }
    if (data[0].acf.sdhq_rating == '2') {
        starImage = starTwo;
    }
    if (data[0].acf.sdhq_rating == '3') {
        starImage = starThree;
    }
    if (data[0].acf.sdhq_rating == '4') {
        starImage = starFour;
    }
    if (data[0].acf.sdhq_rating == '5') {
        starImage = starFive;
    }

    const indicator = (
      <a
        href={data[0].link}
        style={{
          position: 'absolute',
          bottom: 50,
          right: 24,
          display: 'flex',
          alignItems: 'center',
          padding: '0px 20px',
          backgroundColor: 'rgba(0,0,0,80%)',
          color: 'rgba(255,255,255,100%)',
          fontSize: 12,
          textDecoration: 'none',
          borderRadius: 4,
        }}
        data-smm-sdhq={true}
      >
        <p>SDHQ Rating:&nbsp;</p>

        <img style={{
            width: '70px'
        }}
        src={starImage}/>
      </a>
    );

    document
      .querySelector(SHARED_SELECTORS.appDetailsHeader)!
      .appendChild(indicator as unknown as HTMLElement);
  });
};

export const unload = () => {
	document
		.querySelectorAll('[data-smm-sdhq]')
		.forEach((node) => node.remove());
};
